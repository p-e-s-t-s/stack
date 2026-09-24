// @magpiejs/indexers: registry of indexer instances, search fan-out, health and backoff.
// Each indexer (e.g. a Prowlarr Torznab URL) is a plugin instance that registers here.

import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/jobs'
import type {
  IndexerProvider,
  MediaKind,
  Protocol,
  ReleaseInfo,
  ReleaseQuery,
  SearchType,
} from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    indexers: IndexersService
  }
  interface Events {
    'indexers/changed'(): void
    /** New releases from an indexer's RSS feed since the last sync. */
    'indexers/rss'(
      releases: (ReleaseInfo & { indexerName: string; indexerPriority: number })[],
    ): void
  }
}

export interface IndexerOptions {
  /** Shown in the UI. */
  name: string
  /** Lower is preferred when releases are otherwise equal. */
  priority: number
  enableRss: boolean
  enableAutomatic: boolean
  enableInteractive: boolean
}

export interface RegisteredIndexer extends IndexerOptions {
  provider: IndexerProvider
}

export interface IndexerHealth extends IndexerOptions {
  id: string
  protocol: Protocol
  healthy: boolean
  failures: number
  disabledUntil: number | null
  lastError: string | null
  lastSuccessAt: number | null
}

export interface SearchOutcome {
  releases: (ReleaseInfo & { indexerName: string; indexerPriority: number })[]
  errors: { indexer: string; message: string }[]
}

const MINUTE = 60_000
/** Backoff after consecutive failures: 5 min, 15, 30, 1 h, 3 h, then 6 h. */
const BACKOFF = [5, 15, 30, 60, 180, 360].map((m) => m * MINUTE)

export class IndexersService extends Service {
  static inject = ['database', 'jobs']

  db!: Drizzle<typeof schema>
  timeout = 30_000
  now = () => Date.now()
  private indexers = new Map<string, RegisteredIndexer>()

  constructor(ctx: Context) {
    super(ctx, 'indexers')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'indexers',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define(
      'indexers.rss',
      async () => {
        await this.syncRss()
      },
      { maxAttempts: 1 },
    )
    this.ctx.jobs.schedule('indexers.rss', 'indexers.rss', this.rssInterval)
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  rssInterval = 15 * 60_000

  /** Reads every RSS-enabled indexer's feed and announces releases newer than last time. */
  async syncRss() {
    const fresh: (ReleaseInfo & { indexerName: string; indexerPriority: number })[] = []
    await Promise.all(
      this.usable('rss').map(async ([id, indexer]) => {
        if (!indexer.provider.rss) return
        try {
          const releases = await this.withTimeout(indexer.provider.rss())
          this.succeeded(id)
          const last = this.db
            .select()
            .from(schema.status)
            .where(eq(schema.status.indexerId, id))
            .get()?.lastRssGuid
          // feeds are newest first: stop at the newest release seen last time
          const stop = last ? releases.findIndex((r) => r.guid === last) : -1
          const newer = stop >= 0 ? releases.slice(0, stop) : releases
          for (const r of newer)
            fresh.push({
              ...r,
              indexerId: id,
              indexerName: indexer.name,
              indexerPriority: indexer.priority,
            })
          if (releases[0]) {
            this.db
              .update(schema.status)
              .set({ lastRssGuid: releases[0].guid, lastRssAt: this.now() })
              .where(eq(schema.status.indexerId, id))
              .run()
          }
        } catch (error) {
          this.failed(id, error instanceof Error ? error.message : String(error))
        }
      }),
    )
    if (fresh.length) this.ctx.emit('indexers/rss', fresh)
    return fresh
  }

  private searchTypes = new Map<MediaKind, SearchType>()

  /** Says how a kind of media is searched, for the lifetime of the calling plugin. */
  searchType(kind: MediaKind, type: SearchType) {
    return this.ctx.effect(() => {
      this.searchTypes.set(kind, type)
      return () => this.searchTypes.delete(kind)
    }, `indexers.searchType(${kind})`)
  }

  /** How a kind is searched; a plain text search when no plugin said. */
  searchTypeOf(kind: MediaKind): SearchType {
    return this.searchTypes.get(kind) ?? { mode: 'search', defaultCategories: [] }
  }

  /** Kinds with a search type, with their default categories (for RSS). */
  searchKinds() {
    return [...this.searchTypes.entries()]
  }

  /** Registers an indexer for the lifetime of the calling plugin. */
  register(provider: IndexerProvider, options: IndexerOptions) {
    return this.ctx.effect(() => {
      if (this.indexers.has(provider.id))
        throw new Error(`indexer ${provider.id} is already registered`)
      this.indexers.set(provider.id, { ...options, provider })
      this.ctx.emit('indexers/changed')
      return () => {
        this.indexers.delete(provider.id)
        this.ctx.emit('indexers/changed')
      }
    }, `indexers.register(${options.name})`)
  }

  get(id: string) {
    return this.indexers.get(id)
  }

  health(): IndexerHealth[] {
    const rows = new Map(
      this.db
        .select()
        .from(schema.status)
        .all()
        .map((r) => [r.indexerId, r]),
    )
    return [...this.indexers.entries()].map(([id, indexer]) => {
      const s = rows.get(id)
      return {
        id,
        name: indexer.name,
        priority: indexer.priority,
        enableRss: indexer.enableRss,
        enableAutomatic: indexer.enableAutomatic,
        enableInteractive: indexer.enableInteractive,
        protocol: indexer.provider.protocol,
        healthy: !s?.disabledUntil || s.disabledUntil <= this.now(),
        failures: s?.failures ?? 0,
        disabledUntil: s?.disabledUntil ?? null,
        lastError: s?.lastError ?? null,
        lastSuccessAt: s?.lastSuccessAt ?? null,
      }
    })
  }

  /** Indexers usable for a kind of search right now (enabled and not backing off). */
  usable(kind: 'rss' | 'automatic' | 'interactive') {
    const now = this.now()
    const disabled = new Set(
      this.db
        .select()
        .from(schema.status)
        .all()
        .filter((s) => s.disabledUntil && s.disabledUntil > now)
        .map((s) => s.indexerId),
    )
    return [...this.indexers.entries()].filter(([id, i]) => {
      if (kind !== 'interactive' && disabled.has(id)) return false
      return kind === 'rss'
        ? i.enableRss
        : kind === 'automatic'
          ? i.enableAutomatic
          : i.enableInteractive
    })
  }

  /** Searches every usable indexer in parallel; failures are reported, not thrown. */
  async search(
    query: ReleaseQuery,
    kind: 'automatic' | 'interactive' = 'automatic',
  ): Promise<SearchOutcome> {
    const outcome: SearchOutcome = { releases: [], errors: [] }
    await Promise.all(
      this.usable(kind).map(async ([id, indexer]) => {
        try {
          const releases = await this.withTimeout(indexer.provider.search(query))
          this.succeeded(id)
          for (const r of releases) {
            outcome.releases.push({
              ...r,
              indexerId: id,
              indexerName: indexer.name,
              indexerPriority: indexer.priority,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.failed(id, message)
          outcome.errors.push({ indexer: indexer.name, message })
        }
      }),
    )
    return outcome
  }

  /** Tests one indexer's connection without affecting its health. */
  async test(id: string) {
    const indexer = this.indexers.get(id)
    if (!indexer) return { ok: false, message: 'indexer not found' }
    try {
      return await this.withTimeout(indexer.provider.test())
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  succeeded(id: string) {
    const values = { failures: 0, disabledUntil: null, lastError: null, lastSuccessAt: this.now() }
    this.db
      .insert(schema.status)
      .values({ indexerId: id, ...values })
      .onConflictDoUpdate({ target: schema.status.indexerId, set: values })
      .run()
  }

  failed(id: string, message: string) {
    const failures =
      (this.db.select().from(schema.status).where(eq(schema.status.indexerId, id)).get()
        ?.failures ?? 0) + 1
    const values = {
      failures,
      lastError: message,
      disabledUntil: this.now() + BACKOFF[Math.min(failures, BACKOFF.length) - 1]!,
    }
    this.db
      .insert(schema.status)
      .values({ indexerId: id, ...values })
      .onConflictDoUpdate({ target: schema.status.indexerId, set: values })
      .run()
    this.ctx.logger.warn(
      'indexer %s failed (%d in a row): %s',
      this.indexers.get(id)?.name ?? id,
      failures,
      message,
    )
  }

  private withTimeout<T>(promise: Promise<T>) {
    let timer: NodeJS.Timeout
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${this.timeout / 1000} s`)),
        this.timeout,
      )
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }
}

export default IndexersService
