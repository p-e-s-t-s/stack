// @magpiejs/library: media items (movies, series), their files, root folders and naming.
// Kind-specific data lives in the kind's plugin (e.g. `movies_details`).

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/decision'
import { normalizeTitle } from '@magpiejs/parser'
import type { MediaKind } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, asc, eq } from 'drizzle-orm'
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

export interface Naming {
  /** Movie folder, e.g. `{Title} ({Year})`. */
  movieFolder: string
  /** Movie file without extension, e.g. `{Title} ({Year}) [{Quality}]`. */
  movieFile: string
  /** Series folder, e.g. `{Series Title} ({Year})`. */
  seriesFolder: string
  /** Season folder inside it, e.g. `Season {season:00}`; empty for no season folders. */
  seasonFolder: string
  /** Episode file without extension. */
  episodeFile: string
  /** Episode file for daily series. */
  dailyEpisodeFile: string
  /** Episode file for anime series. */
  animeEpisodeFile: string
  /** Hardlink finished torrents (falls back to copy across filesystems). */
  useHardlinks: boolean
  /** Replaced and deleted files go here instead of being deleted; empty to delete. */
  recycleBin: string
}

export const DEFAULT_NAMING: Naming = {
  movieFolder: '{Title} ({Year})',
  movieFile: '{Title} ({Year}) [{Quality}]',
  seriesFolder: '{Series Title} ({Year})',
  seasonFolder: 'Season {season:00}',
  episodeFile: '{Series Title} - S{season:00}E{episode:00} - {Episode Title} [{Quality}]',
  dailyEpisodeFile: '{Series Title} - {Air Date} - {Episode Title} [{Quality}]',
  animeEpisodeFile:
    '{Series Title} - S{season:00}E{episode:00} - {absolute:000} - {Episode Title} [{Quality}]',
  useHardlinks: true,
  recycleBin: '',
}

/** Characters not allowed in file names on common filesystems. */
export function cleanFileName(name: string) {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/, '')
      .trim()
  )
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
  id: MediaKind
  /** Plural, e.g. `Movies`. */
  label: string
}

export class LibraryService extends Service {
  static inject = ['database', 'decision']

  db!: Drizzle<typeof schema>
  private kindInfo = new Map<MediaKind, KindInfo>()

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

  // ---- root folders

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
    this.db.delete(schema.mediaItems).where(eq(schema.mediaItems.id, id)).run()
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

  files(mediaId: number) {
    return this.db
      .select()
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.mediaId, mediaId))
      .all()
  }

  addFile(file: Omit<schema.MediaFile, 'id' | 'addedAt'>) {
    const row = this.db
      .insert(schema.mediaFiles)
      .values({ ...file, addedAt: Date.now() })
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

  // ---- settings

  naming(): Naming {
    const row = this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'naming'))
      .get()
    return { ...DEFAULT_NAMING, ...(row?.value as Partial<Naming> | undefined) }
  }

  saveNaming(naming: Partial<Naming>) {
    const value = { ...this.naming(), ...naming }
    this.db
      .insert(schema.settings)
      .values({ key: 'naming', value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
    return value
  }
}

export default LibraryService
