// @magpiejs/library: media items (movies, series), their files, root folders and naming.
// Kind-specific data lives in the kind's plugin (e.g. `movies_details`).

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/decision'
import { normalizeTitle } from '@magpiejs/parser'
import type { MediaKind } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, asc, eq, isNull } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    library: LibraryService
  }
  interface Events {
    'library/added'(item: schema.MediaItem): void
    'library/updated'(item: schema.MediaItem): void
    'library/deleted'(item: schema.MediaItem): void
    'library/file-added'(item: schema.MediaItem, file: schema.MediaFile): void
    'library/file-removed'(item: schema.MediaItem, file: schema.MediaFile): void
    'library/root-folders'(): void
    'library/kinds'(): void
  }
}

/** A naming template a kind offers, e.g. the movie file name. */
export interface NamingTemplate {
  label: string
  default: string
  help?: string
}

/** A kind's naming templates and the tokens they may use. */
export interface NamingScheme {
  templates: Record<string, NamingTemplate>
  /** Shown in Media management, e.g. `Title`, `season:00`. */
  tokens: string[]
}

/** How files get into the library; shared by every kind. */
export interface FileHandling {
  /** Hardlink finished torrents (falls back to copy across filesystems). */
  useHardlinks: boolean
  /** Replaced and deleted files go here instead of being deleted; empty to delete. */
  recycleBin: string
}

export const DEFAULT_FILE_HANDLING: FileHandling = { useHardlinks: true, recycleBin: '' }

/** Characters not allowed in file names on common filesystems. */
export function cleanFileName(name: string) {
  return name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
}

/**
 * Fills a naming template: `{Title}`, `{Year}`, `{Quality}`, `{Series Title}`… Numbers can be
 * zero-padded: `{season:00}` → `01`. Keys match case-insensitively.
 */
export function renderName(template: string, values: Record<string, string | number | undefined>) {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
  const out = template.replace(
    /\{([A-Za-z][A-Za-z ]*?)(?::(0+))?\}/g,
    (_, key: string, pad?: string) => {
      const value = values[key] ?? lower[key.toLowerCase()]
      if (value === undefined || value === '') return ''
      return pad && typeof value === 'number'
        ? String(value).padStart(pad.length, '0')
        : String(value)
    },
  )
  // tidy empty placeholders: "Title () [ ]" → "Title", "Show - S01E01 - [HD]" → "Show - S01E01 [HD]"
  return cleanFileName(
    out
      .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '')
      .replace(/\s+-\s+(?=-|\[|$)/g, ' ')
      .replace(/\s{2,}/g, ' '),
  )
}

export function sortTitle(title: string) {
  return normalizeTitle(title)
}

/** A kind of media a plugin manages, as shown in the web console. */
export interface KindInfo {
  /** Discovery actions contributed by the kind plugin. */
  browse?: { addPath: string; detailPath: string }
  id: MediaKind
  /** Plural, e.g. `Movies`. */
  label: string
}

export class LibraryService extends Service {
  static inject = ['database', 'decision']

  db!: Drizzle<typeof schema>
  private kindInfo = new Map<MediaKind, KindInfo>()
  private schemes = new Map<MediaKind, NamingScheme>()

  constructor(ctx: Context) {
    super(ctx, 'library')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'library',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  // ---- kinds

  /** Declares a kind of media for the caller's lifetime (root folders, naming, pages). */
  registerKind(info: KindInfo) {
    return this.ctx.effect(() => {
      this.kindInfo.set(info.id, info)
      this.ensureKindRoot(info.id)
      this.ctx.emit('library/kinds')
      return () => {
        this.kindInfo.delete(info.id)
        this.ctx.emit('library/kinds')
      }
    }, `library.registerKind(${info.id})`)
  }

  kinds(): KindInfo[] {
    return [...this.kindInfo.values()]
  }

  /** Declares a kind's naming templates for the caller's lifetime. */
  registerNaming(kind: MediaKind, scheme: NamingScheme) {
    return this.ctx.effect(() => {
      // renderName resolves `{Token}` case-insensitively (so a hand-edited template can spell
      // it however), which means two tokens that differ only by case — `Disc` and `disc:0` —
      // would silently resolve to whichever one happens to come first: catch that here instead.
      const seen = new Map<string, string>()
      for (const token of scheme.tokens) {
        const base = token.split(':')[0]!.toLowerCase()
        const clash = seen.get(base)
        if (clash)
          throw new Error(`naming tokens "${clash}" and "${token}" of ${kind} differ only by case`)
        seen.set(base, token)
      }
      this.schemes.set(kind, scheme)
      this.ctx.emit('library/kinds')
      return () => {
        this.schemes.delete(kind)
        this.ctx.emit('library/kinds')
      }
    }, `library.registerNaming(${kind})`)
  }

  namingScheme(kind: MediaKind) {
    return this.schemes.get(kind)
  }

  // ---- root folders

  /** One parent directory for the whole library. Each kind lives in `<root>/<kind>`. */
  libraryRoot() {
    return this.setting<string>('libraryRoot')
  }

  /**
   * Sets the library parent directory and recreates the kind roots beneath it. Once media has
   * been added, changing this setting is blocked because changing database paths would not move
   * the files on disk.
   */
  saveLibraryRoot(path: string) {
    const root = resolve(path)
    const current = this.libraryRoot()
    if (current === root) {
      for (const kind of this.kindInfo.keys()) this.ensureKindRoot(kind)
      return
    }
    const item = this.db.select({ id: schema.mediaItems.id }).from(schema.mediaItems).get()
    if (item) {
      throw new Error('the library location cannot be changed after media has been added')
    }

    mkdirSync(root, { recursive: true })
    for (const kind of this.kindInfo.keys()) mkdirSync(join(root, kind), { recursive: true })

    this.db.transaction((tx) => {
      tx.delete(schema.rootFolders).run()
      for (const kind of this.kindInfo.keys()) {
        tx.insert(schema.rootFolders)
          .values({ path: join(root, kind), kind })
          .run()
      }
      tx.insert(schema.settings)
        .values({ key: 'libraryRoot', value: root })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: root } })
        .run()
    })
    this.ctx.emit('library/root-folders')
  }

  rootFolders(kind?: MediaKind) {
    const q = this.db.select().from(schema.rootFolders)
    return (kind ? q.where(eq(schema.rootFolders.kind, kind)) : q)
      .orderBy(asc(schema.rootFolders.path))
      .all()
  }

  addRootFolder(path: string, kind: MediaKind) {
    mkdirSync(path, { recursive: true })
    const row = this.db.insert(schema.rootFolders).values({ path, kind }).returning().get()
    this.ctx.emit('library/root-folders')
    return row
  }

  removeRootFolder(id: number) {
    this.db.delete(schema.rootFolders).where(eq(schema.rootFolders.id, id)).run()
    this.ctx.emit('library/root-folders')
  }

  private ensureKindRoot(kind: MediaKind) {
    const root = this.libraryRoot()
    if (!root || this.rootFolders(kind).length) return
    const path = join(root, kind)
    mkdirSync(path, { recursive: true })
    this.db.insert(schema.rootFolders).values({ path, kind }).run()
    this.ctx.emit('library/root-folders')
  }

  // ---- items

  add(item: Omit<schema.NewMediaItem, 'sortTitle' | 'addedAt'>, alternateTitles: string[] = []) {
    const created = this.db.transaction((tx) => {
      const row = tx
        .insert(schema.mediaItems)
        .values({ ...item, sortTitle: sortTitle(item.title), addedAt: Date.now() })
        .returning()
        .get()
      this.setAlternateTitles(row.id, [row.title, ...alternateTitles], tx)
      return row
    })
    this.ctx.emit('library/added', created)
    return created
  }

  update(id: number, patch: Partial<Omit<schema.MediaItem, 'id'>>, alternateTitles?: string[]) {
    const values = patch.title ? { ...patch, sortTitle: sortTitle(patch.title) } : patch
    const row = this.db
      .update(schema.mediaItems)
      .set(values)
      .where(eq(schema.mediaItems.id, id))
      .returning()
      .get()
    if (!row) throw new Error(`media item ${id} not found`)
    if (alternateTitles) this.setAlternateTitles(id, [row.title, ...alternateTitles])
    this.ctx.emit('library/updated', row)
    return row
  }

  remove(id: number) {
    const row = this.get(id)
    if (!row) return
    this.db.transaction((tx) => {
      // files reference targets with `restrict`: they go first
      tx.delete(schema.mediaFiles).where(eq(schema.mediaFiles.mediaId, id)).run()
      tx.delete(schema.targets).where(eq(schema.targets.mediaId, id)).run()
      tx.delete(schema.mediaItems).where(eq(schema.mediaItems.id, id)).run()
    })
    this.ctx.emit('library/deleted', row)
  }

  get(id: number) {
    return this.db.select().from(schema.mediaItems).where(eq(schema.mediaItems.id, id)).get()
  }

  list(kind?: MediaKind) {
    const q = this.db.select().from(schema.mediaItems)
    return (kind ? q.where(eq(schema.mediaItems.kind, kind)) : q)
      .orderBy(asc(schema.mediaItems.sortTitle))
      .all()
  }

  /** Items whose title or alternate title normalizes to `title`. */
  findByTitle(title: string, kind?: MediaKind) {
    const rows = this.db
      .selectDistinct({ item: schema.mediaItems })
      .from(schema.alternateTitles)
      .innerJoin(schema.mediaItems, eq(schema.alternateTitles.mediaId, schema.mediaItems.id))
      .where(
        and(
          eq(schema.alternateTitles.normalized, normalizeTitle(title)),
          kind ? eq(schema.mediaItems.kind, kind) : undefined,
        ),
      )
      .all()
    return rows.map((r) => r.item)
  }

  alternateTitlesOf(mediaId: number) {
    return this.db
      .select({ title: schema.alternateTitles.title })
      .from(schema.alternateTitles)
      .where(eq(schema.alternateTitles.mediaId, mediaId))
      .all()
      .map((r) => r.title)
  }

  /** Absolute folder of an item. */
  folderOf(item: schema.MediaItem) {
    const root = this.db
      .select()
      .from(schema.rootFolders)
      .where(eq(schema.rootFolders.id, item.rootFolderId))
      .get()
    if (!root) throw new Error(`root folder ${item.rootFolderId} not found`)
    return join(root.path, item.folder)
  }

  private setAlternateTitles(
    mediaId: number,
    titles: string[],
    db: Pick<Drizzle<typeof schema>, 'delete' | 'insert'> = this.db,
  ) {
    db.delete(schema.alternateTitles).where(eq(schema.alternateTitles.mediaId, mediaId)).run()
    const unique = new Map(titles.map((t) => [normalizeTitle(t), t]))
    for (const [normalized, title] of unique) {
      if (normalized) db.insert(schema.alternateTitles).values({ mediaId, title, normalized }).run()
    }
  }

  // ---- files

  /**
   * An item's files. Without `targetId` all of them; with it only that target's (`null` is
   * the primary target).
   */
  files(mediaId: number, targetId?: number | null) {
    return this.db
      .select()
      .from(schema.mediaFiles)
      .where(
        and(
          eq(schema.mediaFiles.mediaId, mediaId),
          targetId === undefined
            ? undefined
            : targetId === null
              ? isNull(schema.mediaFiles.targetId)
              : eq(schema.mediaFiles.targetId, targetId),
        ),
      )
      .all()
  }

  addFile(
    file: Omit<schema.MediaFile, 'id' | 'addedAt' | 'targetId'> & { targetId?: number | null },
  ) {
    const row = this.db
      .insert(schema.mediaFiles)
      .values({ ...file, targetId: file.targetId ?? null, addedAt: Date.now() })
      .returning()
      .get()
    this.ctx.emit('library/file-added', this.get(file.mediaId)!, row)
    return row
  }

  removeFile(id: number) {
    const row = this.db
      .delete(schema.mediaFiles)
      .where(eq(schema.mediaFiles.id, id))
      .returning()
      .get()
    if (row) this.ctx.emit('library/file-removed', this.get(row.mediaId)!, row)
    return row
  }

  updateFile(id: number, values: Partial<Omit<schema.MediaFile, 'id' | 'addedAt'>>) {
    const row = this.db
      .update(schema.mediaFiles)
      .set(values)
      .where(eq(schema.mediaFiles.id, id))
      .returning()
      .get()
    if (!row) throw new Error('file record not found')
    this.ctx.emit('library/file-added', this.get(row.mediaId)!, row)
    return row
  }

  // ---- targets (extra versions of an item; the item's own profile is the primary target)

  targets(mediaId: number) {
    return this.db
      .select()
      .from(schema.targets)
      .where(eq(schema.targets.mediaId, mediaId))
      .orderBy(asc(schema.targets.id))
      .all()
  }

  target(id: number) {
    return this.db.select().from(schema.targets).where(eq(schema.targets.id, id)).get()
  }

  addTarget(mediaId: number, values: { name: string; profileId: number; monitored?: boolean }) {
    const item = this.get(mediaId)
    if (!item) throw new Error(`media item ${mediaId} not found`)
    const name = cleanFileName(values.name)
    if (!name) throw new Error('give the version a name')
    if (this.targets(mediaId).some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`this item already has a version named "${name}"`)
    if (!this.ctx.decision.profile(values.profileId)) throw new Error('quality profile not found')
    const row = this.db
      .insert(schema.targets)
      .values({ mediaId, name, profileId: values.profileId, monitored: values.monitored ?? true })
      .returning()
      .get()
    this.ctx.emit('library/updated', item)
    return row
  }

  /** The name is used in file names, so it can only change while the target has no files. */
  updateTarget(id: number, patch: { name?: string; profileId?: number; monitored?: boolean }) {
    const target = this.target(id)
    if (!target) throw new Error('version not found')
    const values: Partial<Pick<schema.Target, 'name' | 'profileId' | 'monitored'>> = {}
    if (patch.name !== undefined && patch.name !== target.name) {
      const name = cleanFileName(patch.name)
      if (!name) throw new Error('give the version a name')
      if (this.files(target.mediaId, id).length)
        throw new Error('a version with files cannot be renamed')
      if (
        this.targets(target.mediaId).some(
          (t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new Error(`this item already has a version named "${name}"`)
      values.name = name
    }
    if (patch.profileId !== undefined) {
      if (!this.ctx.decision.profile(patch.profileId)) throw new Error('quality profile not found')
      values.profileId = patch.profileId
    }
    if (patch.monitored !== undefined) values.monitored = patch.monitored
    const row = Object.keys(values).length
      ? this.db
          .update(schema.targets)
          .set(values)
          .where(eq(schema.targets.id, id))
          .returning()
          .get()!
      : target
    this.ctx.emit('library/updated', this.get(target.mediaId)!)
    return row
  }

  /** Refused while the target still has files: the caller decides what happens to them. */
  removeTarget(id: number) {
    const target = this.target(id)
    if (!target) return
    if (this.files(target.mediaId, id).length)
      throw new Error('remove or move the version’s files first')
    this.db.delete(schema.targets).where(eq(schema.targets.id, id)).run()
    this.ctx.emit('library/updated', this.get(target.mediaId)!)
  }

  // ---- settings

  private setting<T>(key: string): T | undefined {
    return this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
      ?.value as T | undefined
  }

  private saveSetting(key: string, value: unknown) {
    this.db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  }

  /**
   * A kind's naming templates: saved values over the kind's defaults. Values saved before
   * naming was per kind (one `naming` object) are still read.
   */
  naming(kind: MediaKind): Record<string, string> {
    const templates = this.schemes.get(kind)?.templates ?? {}
    const legacy = this.setting<Record<string, string>>('naming') ?? {}
    const saved = this.setting<Record<string, string>>(`naming:${kind}`) ?? {}
    return Object.fromEntries(
      Object.entries(templates).map(([key, t]) => [key, saved[key] ?? legacy[key] ?? t.default]),
    )
  }

  saveNaming(kind: MediaKind, values: Record<string, string>) {
    const known = Object.keys(this.schemes.get(kind)?.templates ?? {})
    const value = {
      ...this.naming(kind),
      ...Object.fromEntries(Object.entries(values).filter(([k]) => known.includes(k))),
    }
    this.saveSetting(`naming:${kind}`, value)
    return value
  }

  fileHandling(): FileHandling {
    const legacy = this.setting<Partial<FileHandling>>('naming') ?? {}
    const saved = this.setting<Partial<FileHandling>>('files') ?? {}
    return {
      useHardlinks: saved.useHardlinks ?? legacy.useHardlinks ?? DEFAULT_FILE_HANDLING.useHardlinks,
      recycleBin: saved.recycleBin ?? legacy.recycleBin ?? DEFAULT_FILE_HANDLING.recycleBin,
    }
  }

  saveFileHandling(patch: Partial<FileHandling>) {
    const value = { ...this.fileHandling(), ...patch }
    this.saveSetting('files', value)
    return value
  }
}

export default LibraryService
