import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { eq, desc } from 'drizzle-orm'
import type { Context } from 'cordis'
import type { Drizzle } from '@magpiejs/database'
import type { MediaItem, MediaFile } from '@magpiejs/library'
import type { MetadataSearchResult } from '@magpiejs/types'
import { profileRanks } from '@magpiejs/decision'
import { parse } from '@magpiejs/parser'
import { fileSystem, findFiles, VIDEO_EXTENSIONS, transfer, recycle } from './files'
import { announceChange } from './changes'
import * as schema from './schema'

export type ReviewKind = 'movie' | 'series'
export interface ReviewRow {
  source: string
  size: number
  mtime: number
  folder: string
  term: string
  selected: boolean
  mediaId?: number
  tmdbId?: number
  profileId?: number
  monitored: boolean
  adopted?: boolean
  seriesType?: 'standard' | 'daily' | 'anime'
  quality: string
  releaseName?: string
  formatScore?: number
  languages: string[]
  episodeIds?: number[]
  episodeKeys?: string[]
  episodeChoices?: { key: string; label: string }[]
  replace: boolean
  /** The version of the item the file is for (`library_targets`); null/absent is the primary. */
  targetId?: number | null
  destination?: string
  conflicts?: number[]
  suggestions: (MetadataSearchResult & { libraryId?: number })[]
  error?: string
  status: 'pending' | 'staged' | 'placed' | 'done' | 'failed'
  method?: string
  placedMtime?: number
  /** The journaled operation that placed this file (see `import_operations`). */
  operationId?: number
}
export interface ReviewSession {
  id: number
  kind: ReviewKind
  mode: 'adopt' | 'manual' | 'rescan' | 'repair'
  path: string
  rootFolderId?: number
  grabId?: number
  transfer: 'hardlink' | 'copy' | 'move'
  rows: ReviewRow[]
  missing: number[]
  removeMissing: boolean
  complete: boolean
}
export interface FilePlan {
  destination: string
  episodeIds?: number[]
  conflicts: number[]
  preserve?: number[]
}
export type FileSelection = Pick<
  ReviewRow,
  'source' | 'quality' | 'releaseName' | 'episodeIds' | 'episodeKeys' | 'targetId'
>
export interface ReviewAdapter {
  lookup(term: string): Promise<MetadataSearchResult[]>
  adopt(row: ReviewRow, rootFolderId: number): Promise<MediaItem>
  plan(item: MediaItem, row: FileSelection): FilePlan
  record(item: MediaItem, row: ReviewRow, file: MediaFile): void
  episodes?(id: number): { id: number; season: number; number: number; title: string | null }[]
  validateAdoption?(row: ReviewRow): Promise<void>
  fileEpisodes?(fileId: number): number[]
  finishAdoption?(itemId: number, monitored: boolean): void
}

export function contained(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path))
  return (
    !isAbsolute(rel) &&
    rel !== '..' &&
    !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
}

/** Persistent previews shared by library adoption, rescans and manual file import. */
export class ReviewService {
  db: Drizzle<typeof schema>
  fs = fileSystem
  private adapters = new Map<ReviewKind, ReviewAdapter>()
  private running = new Set<number>()
  private items = new Set<number>()
  private waiters = new Map<number, (() => void)[]>()
  constructor(private ctx: Context) {
    this.db = ctx.database.register({
      namespace: 'import',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
  }
  register(kind: ReviewKind, adapter: ReviewAdapter) {
    return this.ctx.effect(() => {
      this.adapters.set(kind, adapter)
      this.ctx.emit('import/adapters')
      return () => {
        this.adapters.delete(kind)
        this.ctx.emit('import/adapters')
      }
    })
  }
  kinds() {
    return [...this.adapters.keys()]
  }
  /** Runs `action` once no other import is updating the item, queuing behind one that is. */
  async withItemLock<T>(id: number, action: () => Promise<T>) {
    while (this.items.has(id))
      await new Promise<void>((resolve) => {
        const queue = this.waiters.get(id) ?? []
        queue.push(resolve)
        this.waiters.set(id, queue)
      })
    this.items.add(id)
    try {
      return await action()
    } finally {
      this.unlock(id)
    }
  }
  private unlock(id: number) {
    this.items.delete(id)
    const queue = this.waiters.get(id)
    this.waiters.delete(id)
    for (const wake of queue ?? []) wake()
  }
  adapter(kind: ReviewKind) {
    const adapter = this.adapters.get(kind)
    if (!adapter) throw new Error(`${kind} import is not enabled`)
    return adapter
  }
  list() {
    return this.db
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.id))
      .limit(50)
      .all()
      .map((r) => r.data)
  }
  get(id: number) {
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .get()?.data
    if (!session) throw new Error('import session not found')
    return session
  }
  save(session: ReviewSession) {
    this.db
      .update(schema.sessions)
      .set({ data: session, updatedAt: Date.now() })
      .where(eq(schema.sessions.id, session.id))
      .run()
    this.ctx.emit('import/review')
    return session
  }
  async lookup(kind: ReviewKind, term: string) {
    return this.adapter(kind).lookup(term)
  }
  async scan(options: {
    kind: ReviewKind
    mode: ReviewSession['mode']
    path: string
    mediaId?: number
    grabId?: number
  }) {
    const adapter = this.adapter(options.kind)
    if (!['adopt', 'manual', 'rescan', 'repair'].includes(options.mode))
      throw new Error('invalid scan mode')
    if (!isAbsolute(options.path)) throw new Error('choose an absolute path visible to the server')
    const path = resolve(options.path)
    const item = options.mediaId ? this.ctx.library.get(options.mediaId) : undefined
    if (options.mediaId && (!item || item.kind !== options.kind)) throw new Error('item not found')
    if ((options.mode === 'rescan' || options.mode === 'repair') && !item)
      throw new Error('choose a library item')
    if (item && options.mode !== 'manual' && resolve(this.ctx.library.folderOf(item)) !== path)
      throw new Error('rescan must use the item folder')
    const found = await findFiles(
      path,
      VIDEO_EXTENSIONS,
      { skipExtras: true, maxDepth: 32 },
      this.fs,
    )
    const rows: ReviewRow[] = []
    const roots = this.ctx.library.rootFolders(options.kind)
    const root = options.mode === 'adopt' ? roots.find((r) => resolve(r.path) === path) : undefined
    const cache = new Map<string, MetadataSearchResult[]>()
    for (const file of found) {
      const rel = relative(path, file.path)
      const folder =
        item?.folder ??
        (rel.includes(process.platform === 'win32' ? '\\' : '/') ? rel.split(/[\\/]/)[0]! : '')
      const parsed = parse(basename(file.path, extname(file.path)), { kind: options.kind })
      const folderParsed = parse(folder || basename(dirname(file.path)), { kind: options.kind })
      const term = folder ? folderParsed.title : parsed.title
      const existing =
        item ??
        this.ctx.library
          .list(options.kind)
          .find((m) => resolve(this.ctx.library.folderOf(m)) === resolve(path, folder))
      let suggestions: MetadataSearchResult[] = []
      let error: string | undefined
      if (!existing && options.mode === 'adopt') {
        try {
          if (!cache.has(term)) cache.set(term, await adapter.lookup(term))
          suggestions = cache.get(term)!
        } catch (e) {
          error = String(e instanceof Error ? e.message : e)
        }
      }
      const profile =
        existing?.profileId ?? this.ctx.decision.profiles().find((p) => p.family === 'video')?.id
      const knownFile =
        existing &&
        this.ctx.library
          .files(existing.id)
          .find(
            (f) =>
              resolve(join(this.ctx.library.folderOf(existing), f.path)) === resolve(file.path),
          )
      const quality =
        knownFile?.quality ??
        this.ctx.decision
          .families()
          .find((f) => f.id === 'video')!
          .qualityOf(parsed)
      const row: ReviewRow = {
        source: file.path,
        size: file.size,
        mtime: (await this.fs.stat(file.path)).mtimeMs,
        folder,
        term,
        selected: !!existing,
        mediaId: existing?.id,
        profileId: profile,
        monitored: false,
        quality,
        languages: knownFile?.languages ?? parsed.languages,
        replace: false,
        suggestions,
        status: 'pending',
        error,
      }
      if (knownFile) {
        row.episodeIds = adapter.fileEpisodes?.(knownFile.id)
        row.targetId = knownFile.targetId
      } else if (existing) Object.assign(row, this.assignTarget(existing, file.path, quality))
      row.releaseName = knownFile?.releaseName ?? basename(file.path, extname(file.path))
      if (existing) {
        try {
          const plan = adapter.plan(existing, row)
          row.episodeIds = plan.episodeIds
        } catch (e) {
          row.error = (e as Error).message
          row.selected = false
        }
      }
      rows.push(row)
    }
    const missing =
      item && options.mode === 'rescan'
        ? this.ctx.library
            .files(item.id)
            .filter((f) => !found.some((v) => resolve(v.path) === resolve(path, f.path)))
            .map((f) => f.id)
        : []
    const session: ReviewSession = {
      id: 0,
      kind: options.kind,
      mode: options.mode,
      path,
      rootFolderId: root?.id,
      grabId: options.grabId,
      transfer: 'hardlink',
      rows,
      missing,
      removeMissing: false,
      complete: false,
    }
    const id = this.db
      .insert(schema.sessions)
      .values({ data: session, updatedAt: Date.now() })
      .returning()
      .get().id
    session.id = id
    return this.save(session)
  }
  /**
   * Which version of an item an unrecorded file is for: by its ` - <Version>` file-name
   * suffix, otherwise the only version whose profile allows its quality. Several fitting
   * versions is ambiguous: the row is left for the user to decide instead of guessing.
   */
  private assignTarget(
    item: MediaItem,
    path: string,
    quality: string,
  ): Partial<Pick<ReviewRow, 'targetId' | 'error' | 'selected'>> {
    const extras = this.ctx.library.targets(item.id)
    if (!extras.length) return {}
    const name = basename(path, extname(path)).toLowerCase()
    const suffixed = extras.filter((t) => name.endsWith(` - ${t.name.toLowerCase()}`))
    if (suffixed.length === 1) return { targetId: suffixed[0]!.id }
    const fits = [{ id: null as number | null, profileId: item.profileId }, ...extras].filter(
      (t) => {
        const profile = this.ctx.decision.profile(t.profileId)
        return !!profile && profileRanks(profile).allowed.has(quality)
      },
    )
    if (fits.length === 1) return { targetId: fits[0]!.id }
    return {
      targetId: null,
      selected: false,
      error: 'this item has several versions: choose which one this file is for',
    }
  }
  async preview(
    id: number,
    edits: ReviewRow[],
    transferMode: ReviewSession['transfer'],
    removeMissing = false,
  ) {
    if (this.running.has(id)) throw new Error('import is running')
    if (!['hardlink', 'copy', 'move'].includes(transferMode))
      throw new Error('invalid transfer mode')
    const session = this.get(id)
    const adapter = this.adapter(session.kind)
    for (let i = 0; i < session.rows.length; i++) {
      const row = session.rows[i]!
      if (row.status === 'done' || row.status === 'placed' || row.status === 'staged') continue
      const edit = edits[i]
      if (!edit) continue
      Object.assign(row, {
        selected: !!edit.selected,
        mediaId: edit.mediaId || undefined,
        tmdbId: edit.tmdbId || undefined,
        profileId: edit.profileId,
        monitored: !!edit.monitored,
        quality: edit.quality,
        languages: edit.languages,
        episodeIds: edit.episodeIds,
        episodeKeys: edit.episodeKeys,
        replace: !!edit.replace,
        // an edit that doesn't mention a version keeps the one the scan assigned
        targetId: edit.targetId === undefined ? row.targetId : edit.targetId,
        seriesType: edit.seriesType,
        releaseName: edit.releaseName,
      })
      row.error = undefined
      row.destination = undefined
      row.status = 'pending'
      if (!row.selected) continue
      try {
        if (
          !this.ctx.decision
            .families()
            .find((f) => f.id === 'video')
            ?.qualities.some((q) => q.id === row.quality)
        )
          throw new Error('choose a known video quality')
        if (!Array.isArray(row.languages) || row.languages.some((l) => typeof l !== 'string'))
          throw new Error('invalid languages')
        if (session.mode === 'adopt' && !row.folder)
          throw new Error('put each title in its own folder before adoption')
        const item = row.mediaId ? this.ctx.library.get(row.mediaId) : undefined
        const parsed = parse(row.releaseName || basename(row.source), { kind: session.kind })
        row.formatScore = this.ctx.decision.evaluate(
          {
            info: {
              guid: row.source,
              title: row.releaseName || basename(row.source),
              protocol: 'torrent',
              indexerId: 'manual',
              downloadUrl: '',
              size: row.size,
            },
            parsed: { ...parsed, languages: row.languages },
          },
          {
            kind: session.kind === 'movie' ? 'movie' : 'episode',
            mediaId: item?.id,
            profileId:
              (row.targetId && this.ctx.library.target(row.targetId)?.profileId) ||
              (item?.profileId ?? row.profileId!),
          },
        ).formatScore
        if (item) {
          if (item.kind !== session.kind) throw new Error('wrong media kind')
          const plan = adapter.plan(item, row)
          row.episodeIds = plan.episodeIds
          row.conflicts = plan.conflicts
          row.destination = session.mode === 'manual' ? plan.destination : row.source
          if (session.mode !== 'manual' && !contained(this.ctx.library.folderOf(item), row.source))
            throw new Error('file is outside the item folder')
          const other = this.ctx.library
            .files(item.id)
            .filter(
              (f) =>
                plan.conflicts.includes(f.id) &&
                resolve(join(this.ctx.library.folderOf(item), f.path)) !== resolve(row.source),
            )
          for (const file of other) {
            const exists = await this.fs
              .stat(join(this.ctx.library.folderOf(item), file.path))
              .then(
                () => true,
                (e) => {
                  if (e.code === 'ENOENT') return false
                  throw e
                },
              )
            if (session.mode !== 'repair' && exists && !row.replace)
              throw new Error('existing files conflict; select replacement to continue')
          }
          if (session.mode === 'manual' && resolve(row.source) !== resolve(row.destination)) {
            const exists = await this.fs.stat(row.destination).then(
              () => true,
              (e) => {
                if (e.code === 'ENOENT') return false
                throw e
              },
            )
            if (exists && !row.replace) throw new Error('destination exists; select replacement')
          }
        } else if (session.mode !== 'adopt' || !row.tmdbId || !row.profileId)
          throw new Error('choose a library item or metadata match and quality profile')
        else {
          if (this.ctx.decision.profile(row.profileId!)?.family !== 'video')
            throw new Error('choose a video quality profile')
          await adapter.validateAdoption?.(row)
          row.destination = row.source
        }
      } catch (e) {
        row.error = (e as Error).message
      }
    }
    const destinations = new Set<string>()
    for (const row of session.rows.filter((r) => r.selected && !r.error && r.destination)) {
      const key = resolve(row.destination!)
      if (destinations.has(key)) row.error = 'another selected file has the same destination'
      destinations.add(key)
    }
    if (session.kind === 'series') {
      const episodes = new Set<string>()
      for (const row of session.rows.filter((r) => r.selected && !r.error && r.status !== 'done')) {
        const keys = row.mediaId
          ? row.episodeIds?.map((id) => `id:${id}`)
          : row.episodeKeys?.map((k) => `${row.tmdbId}:${k}`)
        for (const key of keys ?? []) {
          if (episodes.has(key)) row.error = 'another selected file covers the same episode'
          episodes.add(key)
        }
      }
    } else {
      const movies = new Set<string>()
      for (const row of session.rows.filter((r) => r.selected && !r.error && r.status !== 'done')) {
        const key = row.mediaId
          ? `id:${row.mediaId}:${row.targetId ?? 'primary'}`
          : `tmdb:${row.tmdbId}`
        if (movies.has(key))
          row.error = row.targetId
            ? 'choose one file per version'
            : 'choose one main file per movie'
        movies.add(key)
      }
    }
    session.transfer = transferMode
    session.removeMissing = removeMissing
    session.complete = false
    return this.save(session)
  }
  async commit(id: number) {
    if (this.running.has(id)) throw new Error('import is already running')
    const session = this.get(id)
    if (session.complete) return session
    this.running.add(id)
    // everything this commit changes can be undone together
    const batchId = randomUUID()
    try {
      // Verify the scan root before touching missing records, including on resumed runs.
      await this.fs.stat(session.path)
      const adapter = this.adapter(session.kind)
      for (const row of session.rows) {
        if (!row.selected || row.status === 'done' || (row.error && row.status === 'pending'))
          continue
        let locked: number | undefined
        try {
          row.error = undefined
          if (!row.destination) throw new Error('preview this selection before importing')
          let item = row.mediaId ? this.ctx.library.get(row.mediaId) : undefined
          if (!item) {
            const root =
              this.ctx.library
                .rootFolders(session.kind)
                .find((r) => resolve(r.path) === session.path) ??
              this.ctx.library.addRootFolder(session.path, session.kind)
            item = await adapter.adopt(row, root.id)
            row.mediaId = item.id
            row.adopted = true
            this.save(session)
          }
          if (this.items.has(item.id))
            throw new Error('another import is updating this item; retry later')
          this.items.add(item.id)
          locked = item.id
          const folder = this.ctx.library.folderOf(item)
          const recorder = this.ctx.import.recorder(item, { batchId, targetId: row.targetId })
          recorder.current = row.operationId
          const plan = adapter.plan(item, row)
          const dest = session.mode === 'manual' ? plan.destination : row.source
          if (row.destination !== dest) throw new Error('destination changed; preview again')
          if (!contained(folder, dest)) throw new Error('destination is outside the library item')
          row.episodeIds = plan.episodeIds
          const conflicts = this.ctx.library
            .files(item.id)
            .filter(
              (f) =>
                plan.conflicts.includes(f.id) && resolve(join(folder, f.path)) !== resolve(dest),
            )
          for (const file of conflicts) {
            const exists = await this.fs.stat(join(folder, file.path)).then(
              () => true,
              (e) => {
                if (e.code === 'ENOENT') return false
                throw e
              },
            )
            if (session.mode !== 'repair' && exists && !row.replace)
              throw new Error('existing file conflict; preview replacement first')
          }
          const old = conflicts.filter((f) => !plan.preserve?.includes(f.id))
          if (row.status !== 'placed' && row.status !== 'staged') {
            const stat = await this.fs.stat(row.source)
            if (stat.size !== row.size || stat.mtimeMs !== row.mtime)
              throw new Error('source changed since scan; scan again')
          }
          if (session.mode === 'manual' && resolve(row.source) !== resolve(dest)) {
            const stage = `${dest}.magpie-review-${session.id}-${session.rows.indexOf(row)}`
            const backup = `${stage}.previous`
            if (row.status !== 'placed') {
              if (row.status !== 'staged') {
                const exists = await this.fs.stat(dest).then(
                  () => true,
                  (e) => {
                    if (e.code === 'ENOENT') return false
                    throw e
                  },
                )
                if (exists && !row.replace)
                  throw new Error('destination exists; select replacement')
                // recorded before the first byte moves, and before the records change
                row.operationId = recorder.begin({
                  source: row.source,
                  dest,
                  method: session.transfer,
                  replacing: exists,
                })
                recorder.current = row.operationId
                // Stage with copy/hardlink first; preserve move sources until records are committed.
                row.method = await transfer(
                  row.source,
                  stage,
                  session.transfer === 'move' ? 'copy' : session.transfer,
                  this.fs,
                )
                row.placedMtime = (await this.fs.stat(stage)).mtimeMs
                row.status = 'staged'
                this.save(session)
              }
              const staged = await this.fs.stat(stage).then(
                () => true,
                (e) => {
                  if (e.code === 'ENOENT') return false
                  throw e
                },
              )
              if (staged) {
                const backed = await this.fs.stat(backup).then(
                  () => true,
                  (e) => {
                    if (e.code === 'ENOENT') return false
                    throw e
                  },
                )
                if (!backed)
                  await this.fs.rename(dest, backup).catch((e) => {
                    if (e.code !== 'ENOENT') throw e
                  })
                try {
                  await this.fs.rename(stage, dest)
                } catch (error) {
                  await this.fs.rename(backup, dest).catch((e) => {
                    if (e.code !== 'ENOENT') throw e
                  })
                  throw error
                }
              } else if ((await this.fs.stat(dest)).mtimeMs !== row.placedMtime) {
                throw new Error(
                  'staged file is missing and destination does not match; repair required',
                )
              }
              row.status = 'placed'
              this.save(session)
            }
            const placed = await this.fs.stat(dest)
            if (placed.size !== row.size || placed.mtimeMs !== row.placedMtime)
              throw new Error('placed file differs; repair required')
            // Backup is retained until the database and episode mappings have committed.
          }
          const parsed = parse(row.releaseName || basename(row.source, extname(row.source)), {
            kind: session.kind,
          })
          const existing = this.ctx.library
            .files(item.id)
            .find((f) => resolve(join(folder, f.path)) === resolve(dest))
          // kept files lose the episode links this one takes over; undo gives them back
          const kept = (plan.preserve ?? []).flatMap((fid) =>
            (adapter.fileEpisodes?.(fid) ?? [])
              .filter((eid) => plan.episodeIds?.includes(eid))
              .map((eid) => [eid, fid]),
          )
          if (kept.length) recorder.annotate({ links: kept })
          let recorded!: MediaFile
          this.ctx.library.db.transaction(() => {
            const values = {
              mediaId: item.id,
              targetId: row.targetId ?? null,
              path: relative(folder, dest),
              size: row.size,
              quality: row.quality,
              formatScore: row.formatScore ?? 0,
              languages: row.languages,
              releaseName: row.releaseName || basename(row.source),
              releaseGroup: parsed.group ?? null,
              revision: parsed.revision,
            }
            recorded = existing
              ? this.ctx.library.updateFile(existing.id, values)
              : this.ctx.library.addFile(values)
            adapter.record(item, row, recorded)
          })
          if (session.mode !== 'repair')
            for (const f of old) {
              if (session.mode === 'manual') await recorder.recycle(join(folder, f.path), f)
              this.ctx.library.removeFile(f.id)
            }
          if (session.mode === 'manual' && resolve(row.source) !== resolve(dest)) {
            const backup = `${dest}.magpie-review-${session.id}-${session.rows.indexOf(row)}.previous`
            const trashPath = await recycle(backup, recorder.bin, this.fs, dest)
            if (session.transfer === 'move') {
              const source = await this.fs.stat(row.source).catch((e) => {
                if (e.code === 'ENOENT') return undefined
                throw e
              })
              if (source && (source.size !== row.size || source.mtimeMs !== row.mtime))
                throw new Error('move source changed after staging; source preserved for repair')
              if (source) await this.fs.unlink(row.source)
            }
            await recorder.finish(row.operationId, { trashPath, method: session.transfer })
          }
          row.status = 'done'
          this.ctx.get('history')?.add(item.id, 'imported', basename(row.source), {
            source: row.source,
            path: dest,
            mode: session.mode,
            ...(row.operationId ? { batchId, operationId: row.operationId } : {}),
          })
          // only the manual flow changes files on disk; adopt, rescan and repair just record
          if (session.mode === 'manual')
            announceChange(this.ctx, {
              origin: 'manual',
              item,
              added: [dest],
              removed: old
                .map((f) => join(folder, f.path))
                .filter((p) => resolve(p) !== resolve(dest)),
              replaced: old.length > 0,
              release: row.releaseName,
            })
        } catch (e) {
          row.error = (e as Error).message
          if (row.status !== 'placed' && row.status !== 'staged') {
            row.status = 'failed'
            // nothing was placed, so there is nothing to undo
            if (row.operationId) {
              this.ctx.import.journal.abandon(row.operationId, row.error)
              row.operationId = undefined
            }
          }
        } finally {
          if (locked) this.unlock(locked)
          this.save(session)
        }
      }
      if (session.removeMissing && session.mode === 'rescan') {
        for (const fid of session.missing) {
          const item = this.ctx.library
            .list(session.kind)
            .find((m) => this.ctx.library.files(m.id).some((f) => f.id === fid))
          const file = item && this.ctx.library.files(item.id).find((f) => f.id === fid)
          if (!item || !file) continue
          await this.fs.stat(this.ctx.library.folderOf(item))
          const absent = await this.fs.stat(join(this.ctx.library.folderOf(item), file.path)).then(
            () => false,
            (e) => {
              if (e.code === 'ENOENT') return true
              throw e
            },
          )
          if (absent) this.ctx.library.removeFile(fid)
        }
      }
      session.complete = session.rows.filter((r) => r.selected).every((r) => r.status === 'done')
      if (session.mode === 'adopt') {
        const groups = new Set(session.rows.filter((r) => r.adopted).map((r) => r.folder))
        for (const folder of groups) {
          const rows = session.rows.filter((r) => r.folder === folder && r.selected)
          if (rows.length && rows.every((r) => r.status === 'done'))
            adapter.finishAdoption?.(
              rows[0]!.mediaId!,
              rows.some((r) => r.monitored),
            )
        }
      }
      if (session.grabId && session.complete && session.rows.every((r) => r.status === 'done'))
        this.ctx.downloads.setState(session.grabId, 'imported')
      return this.save(session)
    } finally {
      this.running.delete(id)
    }
  }
}
