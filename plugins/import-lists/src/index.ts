// @magpiejs/import-lists: adds movies and series from external lists. List plugins (TMDB,
// Trakt, IMDb, Plex) register a provider with the defaults for what it adds; this plugin
// syncs each one on a schedule, resolves titles to TMDB ids, skips what the library already
// has or the user excluded, and adds the rest through the movies and series plugins.
// Lists are one-way: nothing is ever written back, and nothing is removed from the library.

import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/jobs'
import type {} from '@magpiejs/metadata'
import type {} from '@magpiejs/movies'
import type {} from '@magpiejs/series'
import type { ImportListProvider, ListEntry, TestResult } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, eq } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    importLists: ImportListsService
  }
  interface Events {
    'importlists/changed'(): void
  }
}

const HOUR = 60 * 60_000

export interface ListSettings {
  profileId: number
  rootFolderId: number
  monitor: boolean
  search: boolean
  intervalHours: number
}

export interface Config {
  /** Most titles one sync adds; the rest wait for the next run so the queue is not blocked. */
  maxAddsPerSync: number
}

export interface ListInfo {
  id: string
  name: string
  kinds: string[]
  settings: ListSettings
  status?: schema.ListStatus
}

interface Registered {
  provider: ImportListProvider
  name: string
  settings: ListSettings
}

export interface SyncResult {
  added: number
  existing: number
  excluded: number
  unmatched: number
  failed: number
  error?: string
}

type Kind = 'movie' | 'series'

export const keyOf = (kind: Kind, tmdb: string) => `${kind}:tmdb:${tmdb}`
const normalize = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Error text for the UI: one line, no URLs (they can carry tokens). */
export function sanitize(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/https?:\/\/\S+/g, '<url>')
    .split('\n')[0]!
    .slice(0, 300)
}

export class ImportListsService extends Service {
  static inject = ['database', 'jobs', 'library', 'metadata']

  db!: Drizzle<typeof schema>
  config: Config
  now = () => Date.now()
  private lists = new Map<string, Registered>()
  private running = new Set<string>()

  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'importLists')
    this.config = { maxAddsPerSync: 50, ...config }
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'importlists',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define(
      'importlists.sync',
      async (payload: { id: string }, { signal }) => {
        const result = await this.sync(payload.id, signal)
        // a failed sync is retried by the queue; one that ran (even with some titles
        // failing) is done until the next interval
        if (result.error && !result.added && !result.existing) throw new Error(result.error)
      },
      { maxAttempts: 2 },
    )
    // a user deleting a title that a list added means "not again"
    this.ctx.on('library/deleted', (item) => {
      if (item.kind !== 'movie' && item.kind !== 'series') return
      const tmdb = item.externalIds.tmdb
      if (!tmdb) return
      const key = keyOf(item.kind, tmdb)
      const added = this.db
        .select()
        .from(schema.seen)
        .where(and(eq(schema.seen.key, key), eq(schema.seen.status, 'added')))
        .get()
      if (added) this.exclude({ key, kind: item.kind, title: item.title })
    })
    this.ctx.inject(['webui', 'timer'], (ctx) => void ctx.plugin(console_, this))
  }

  // ---- lists

  /** Adds a list for the lifetime of the calling plugin and schedules its syncs. */
  register(provider: ImportListProvider, options: { name: string; settings: ListSettings }) {
    if (this.lists.has(provider.id)) throw new Error(`list ${provider.id} is already registered`)
    const unschedule = this.ctx.jobs.schedule(
      `importlists.sync:${provider.id}`,
      'importlists.sync',
      options.settings.intervalHours * HOUR,
      { id: provider.id },
    )
    return this.ctx.effect(() => {
      this.lists.set(provider.id, { provider, ...options })
      this.ctx.emit('importlists/changed')
      return () => {
        this.lists.delete(provider.id)
        unschedule()
        this.ctx.emit('importlists/changed')
      }
    }, `importLists.register(${options.name})`)
  }

  info(): ListInfo[] {
    const statuses = new Map(
      this.db
        .select()
        .from(schema.status)
        .all()
        .map((s) => [s.listId, s]),
    )
    return [...this.lists].map(([id, l]) => ({
      id,
      name: l.name,
      kinds: l.provider.kinds,
      settings: l.settings,
      status: statuses.get(id),
    }))
  }

  async test(id: string): Promise<TestResult> {
    const entry = this.lists.get(id)
    if (!entry) return { ok: false, message: 'not running; check that it is enabled' }
    try {
      return await entry.provider.test()
    } catch (error) {
      return { ok: false, message: sanitize(error) }
    }
  }

  /** Queues a sync now (the job runs it, with retries). */
  syncNow(id: string) {
    if (!this.lists.has(id)) throw new Error('that list is not running')
    this.ctx.jobs.enqueue('importlists.sync', { id }, { dedupeKey: `importlists.sync:${id}` })
  }

  // ---- sync

  async sync(id: string, signal?: AbortSignal): Promise<SyncResult> {
    const list = this.lists.get(id)
    if (!list) throw new Error('that list is not running')
    const result: SyncResult = { added: 0, existing: 0, excluded: 0, unmatched: 0, failed: 0 }
    if (this.running.has(id)) return { ...result, error: 'a sync is already running' }
    this.running.add(id)
    try {
      const entries = await list.provider.fetch({ signal })
      const have = this.libraryIds()
      const excluded = new Set(
        this.db
          .select({ key: schema.exclusions.key })
          .from(schema.exclusions)
          .all()
          .map((e) => e.key),
      )
      const errors = new Set<string>()
      const seenKeys = new Set<string>()
      for (const entry of entries) {
        if (signal?.aborted) throw new Error('sync cancelled')
        if (!list.provider.kinds.includes(entry.kind)) continue
        if (!this.ctx.get(entry.kind === 'movie' ? 'movies' : 'series')) continue
        let tmdb: string | undefined
        try {
          tmdb = await this.resolve(entry)
        } catch (error) {
          result.failed++
          errors.add(sanitize(error))
          continue
        }
        if (!tmdb) {
          result.unmatched++
          this.record(
            id,
            entry,
            `${entry.kind}:title:${normalize(entry.title)} ${entry.year ?? ''}`,
            'unmatched',
          )
          continue
        }
        const key = keyOf(entry.kind, tmdb)
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        if (have[entry.kind].has(tmdb)) {
          result.existing++
          continue
        }
        if (excluded.has(key)) {
          result.excluded++
          continue
        }
        if (result.added >= this.config.maxAddsPerSync) continue
        try {
          const mediaId = await this.add(entry.kind, Number(tmdb), list.settings)
          have[entry.kind].add(tmdb)
          result.added++
          this.record(id, entry, key, 'added', mediaId)
        } catch (error) {
          result.failed++
          errors.add(sanitize(error))
        }
      }
      if (errors.size) result.error = [...errors][0]
      this.saveStatus(id, result)
      return result
    } catch (error) {
      result.error = sanitize(error)
      this.saveStatus(id, result)
      return result
    } finally {
      this.running.delete(id)
      this.ctx.emit('importlists/changed')
    }
  }

  /** TMDB id for an entry: its own, else mapped from imdb/tvdb, else an exact title + year match. */
  private async resolve(entry: ListEntry): Promise<string | undefined> {
    if (entry.ids.tmdb) return entry.ids.tmdb
    const provider = this.ctx.metadata.for(entry.kind, 'tmdb')
    if (!provider) throw new Error('no TMDB metadata provider is enabled (add TMDB in Settings)')
    if ((entry.ids.imdb || entry.ids.tvdb) && provider.mapIds) {
      const mapped = await provider.mapIds(entry.ids, entry.kind)
      if (mapped.tmdb) return mapped.tmdb
    }
    // titles without any id are matched only when exactly one result has the same name and
    // year; anything else is left for a person
    if (!entry.year) return undefined
    const results = await provider.search({ term: entry.title, kind: entry.kind })
    const exact = results.filter(
      (r) => r.year === entry.year && normalize(r.title) === normalize(entry.title) && r.ids.tmdb,
    )
    return exact.length === 1 ? exact[0]!.ids.tmdb : undefined
  }

  private async add(kind: Kind, tmdbId: number, s: ListSettings): Promise<number> {
    if (kind === 'movie') {
      const movie = await this.ctx.get('movies')!.add({
        tmdbId,
        profileId: s.profileId,
        rootFolderId: s.rootFolderId,
        monitored: s.monitor,
        search: s.search,
      })
      return movie.id
    }
    const series = await this.ctx.get('series')!.add({
      tmdbId,
      profileId: s.profileId,
      rootFolderId: s.rootFolderId,
      monitor: s.monitor ? 'all' : 'none',
      search: s.search,
    })
    return series.id
  }

  private libraryIds(): Record<Kind, Set<string>> {
    return {
      movie: new Set((this.ctx.get('movies')?.list() ?? []).map((m) => String(m.details.tmdbId))),
      series: new Set((this.ctx.get('series')?.list() ?? []).map((s) => String(s.details.tmdbId))),
    }
  }

  private record(
    listId: string,
    entry: ListEntry,
    key: string,
    status: schema.SeenRow['status'],
    mediaId?: number,
  ) {
    const now = this.now()
    this.db
      .insert(schema.seen)
      .values({
        listId,
        key,
        kind: entry.kind,
        title: entry.title,
        year: entry.year ?? null,
        status,
        mediaId: mediaId ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.seen.listId, schema.seen.key],
        set: { lastSeenAt: now, ...(mediaId ? { status, mediaId } : {}) },
      })
      .run()
  }

  private saveStatus(id: string, r: SyncResult) {
    const values = {
      lastSyncedAt: this.now(),
      lastError: r.error ?? null,
      added: r.added,
      existing: r.existing,
      excluded: r.excluded,
      unmatched: r.unmatched,
      failed: r.failed,
    }
    this.db
      .insert(schema.status)
      .values({ listId: id, ...values })
      .onConflictDoUpdate({ target: schema.status.listId, set: values })
      .run()
  }

  // ---- results and exclusions

  unmatched(listId?: string) {
    const q = this.db.select().from(schema.seen)
    return (
      listId
        ? q.where(and(eq(schema.seen.listId, listId), eq(schema.seen.status, 'unmatched')))
        : q.where(eq(schema.seen.status, 'unmatched'))
    ).all()
  }

  exclusions() {
    return this.db.select().from(schema.exclusions).all()
  }

  exclude(item: { key: string; kind: Kind; title: string }) {
    this.db
      .insert(schema.exclusions)
      .values({ ...item, createdAt: this.now() })
      .onConflictDoNothing()
      .run()
    this.ctx.emit('importlists/changed')
  }

  unexclude(key: string) {
    this.db.delete(schema.exclusions).where(eq(schema.exclusions.key, key)).run()
    this.ctx.emit('importlists/changed')
  }
}

export default ImportListsService
