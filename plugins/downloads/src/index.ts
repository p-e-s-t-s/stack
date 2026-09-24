// @magpiejs/downloads: download client registry, grabbing, download tracking and the
// blocklist. Finished downloads are announced with `downloads/completed` for the import plugin.

import type {} from '@cordisjs/plugin-http'
import type {} from '@cordisjs/plugin-timer'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/decision'
import type {} from '@magpiejs/api'
import type {} from '@magpiejs/jobs'
import type {
  DownloadClient,
  DownloadPayload,
  DownloadStatus,
  Protocol,
  ReleaseInfo,
} from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, desc, eq, inArray, or } from 'drizzle-orm'
import z from 'schemastery'
import console_ from './console'
import * as schema from './schema'
import { infoHashOf, magnetHash } from './torrent'

export * from './schema'
export { infoHashOf, magnetHash } from './torrent'

declare module 'cordis' {
  interface Context {
    downloads: DownloadsService
  }
  interface Events {
    'downloads/grabbed'(grab: schema.Grab): void
    'downloads/updated'(grab: schema.Grab): void
    'downloads/completed'(grab: schema.Grab): void
    'downloads/failed'(grab: schema.Grab): void
    'downloads/clients'(): void
  }
}

export interface ClientOptions {
  name: string
  /** Lower is preferred. */
  priority: number
  category: string
}

export interface ClientHealth extends ClientOptions {
  id: string
  protocol: Protocol
}

export interface GrabOptions {
  quality: string
  formatScore: number
  manual?: boolean
}

export interface DownloadsConfig {
  pollInterval: number
  stalledMinutes: number
  missingMinutes: number
}

export const DownloadsConfig: z<Partial<DownloadsConfig>, DownloadsConfig> = z.object({
  pollInterval: z
    .natural()
    .default(60)
    .description('Seconds between checks of the download clients.'),
  stalledMinutes: z
    .natural()
    .default(60)
    .description('A download without progress for this long is marked stalled.'),
  missingMinutes: z
    .natural()
    .default(10)
    .description('A grab not seen in its client for this long is marked failed.'),
})

const TERMINAL: schema.GrabState[] = ['imported', 'failed', 'import_failed', 'removed']

export class DownloadsService extends Service {
  static inject = ['database', 'jobs', 'decision', 'http', 'library', 'timer']
  static Config = DownloadsConfig

  db!: Drizzle<typeof schema>
  config: DownloadsConfig
  now = () => Date.now()
  private clients = new Map<string, { client: DownloadClient; options: ClientOptions }>()

  constructor(ctx: Context, config: Partial<DownloadsConfig> = {}) {
    super(ctx, 'downloads')
    this.config = DownloadsConfig(config)
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'downloads',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define('downloads.monitor', () => this.monitor(), { maxAttempts: 1 })
    this.ctx.jobs.schedule(
      'downloads.monitor',
      'downloads.monitor',
      this.config.pollInterval * 1000,
    )

    this.ctx.decision.rule('blocklist', ({ info, target }) => {
      if (!target.mediaId) return
      const hash = info.infoHash?.toLowerCase()
      const hit = this.db
        .select()
        .from(schema.blocklist)
        .where(
          and(
            eq(schema.blocklist.mediaId, target.mediaId),
            hash
              ? or(eq(schema.blocklist.title, info.title), eq(schema.blocklist.infoHash, hash))
              : eq(schema.blocklist.title, info.title),
          ),
        )
        .get()
      if (hit) return { reason: `blocklisted: ${hit.reason}`, permanent: true }
    })

    // movies only: a series has many episodes, and the series plugin checks those itself
    this.ctx.decision.rule('in-queue', ({ target, qualityRank, formatScore, rankOf }) => {
      if (!target.mediaId || target.kind !== 'movie') return
      const active = this.active().filter((g) => g.mediaId === target.mediaId)
      for (const grab of active) {
        const rank = rankOf(grab.quality)
        if (rank > qualityRank || (rank === qualityRank && grab.formatScore >= formatScore)) {
          return `already downloading ${grab.title}`
        }
      }
    })

    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    this.ctx.inject(['api'], (ctx) => {
      ctx.api.get('/queue', () => this.active())
      ctx.api.delete('/queue/:id', async ({ params, query }) => {
        await this.remove(Number(params.id), {
          deleteData: query.get('deleteData') === 'true',
          blocklist: query.get('blocklist') === 'true',
        })
      })
    })
  }

  // ---- clients

  register(client: DownloadClient, options: ClientOptions) {
    return this.ctx.effect(() => {
      if (this.clients.has(client.id))
        throw new Error(`download client ${client.id} is already registered`)
      this.clients.set(client.id, { client, options })
      this.ctx.emit('downloads/clients')
      return () => {
        this.clients.delete(client.id)
        this.ctx.emit('downloads/clients')
      }
    }, `downloads.register(${options.name})`)
  }

  listClients(): ClientHealth[] {
    return [...this.clients.entries()].map(([id, { client, options }]) => ({
      id,
      protocol: client.protocol,
      ...options,
    }))
  }

  async testClient(id: string) {
    const entry = this.clients.get(id)
    if (!entry) return { ok: false, message: 'client not found' }
    try {
      return await entry.client.test()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private pickClient(protocol: Protocol) {
    const candidates = [...this.clients.entries()]
      .filter(([, c]) => c.client.protocol === protocol)
      .sort((a, b) => a[1].options.priority - b[1].options.priority)
    return candidates[0]
  }

  // ---- grabbing

  /** Turns a release's download URL into what a client accepts. */
  async resolve(release: ReleaseInfo): Promise<DownloadPayload> {
    if (release.protocol === 'usenet') {
      const data = new Uint8Array(
        await this.ctx.http.get(release.downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 60_000,
        }),
      )
      return { type: 'nzb', data, release }
    }
    let url = release.downloadUrl
    for (let hops = 0; hops < 5; hops++) {
      if (url.startsWith('magnet:')) {
        const hash = magnetHash(url) ?? release.infoHash?.toLowerCase()
        if (!hash) throw new Error('magnet link has no info hash')
        return { type: 'magnet', uri: url, hash, release }
      }
      const response = await this.ctx.http(url, {
        redirect: 'manual',
        timeout: 60_000,
        validateStatus: () => true,
      } as never)
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url).toString()
        continue
      }
      if (response.status >= 400)
        throw new Error(`could not download the torrent file (HTTP ${response.status})`)
      const data = new Uint8Array(await response.arrayBuffer())
      return { type: 'torrent', data, hash: infoHashOf(data), release }
    }
    throw new Error('too many redirects')
  }

  async grab(mediaId: number, release: ReleaseInfo, options: GrabOptions) {
    const picked = this.pickClient(release.protocol)
    if (!picked) throw new Error(`no ${release.protocol} download client is enabled`)
    const [clientId, { client, options: clientOptions }] = picked
    const payload = await this.resolve(release)
    const downloadId = (
      await client.add(payload, { category: clientOptions.category })
    ).toLowerCase()
    const now = this.now()
    const grab = this.db
      .insert(schema.grabs)
      .values({
        mediaId,
        release,
        title: release.title,
        quality: options.quality,
        formatScore: options.formatScore,
        protocol: release.protocol,
        clientId,
        downloadId,
        state: 'grabbed',
        manual: !!options.manual,
        sizeBytes: release.size ?? null,
        grabbedAt: now,
        updatedAt: now,
        lastProgressAt: now,
      })
      .returning()
      .get()
    this.ctx.logger.info('grabbed %s with %s', release.title, clientOptions.name)
    this.ctx.emit('downloads/grabbed', grab)
    return grab
  }

  // ---- tracking

  active() {
    return this.db
      .select()
      .from(schema.grabs)
      .where(inArray(schema.grabs.state, schema.ACTIVE_STATES))
      .all()
  }

  get(id: number) {
    return this.db.select().from(schema.grabs).where(eq(schema.grabs.id, id)).get()
  }

  recent(limit = 100) {
    return this.db
      .select()
      .from(schema.grabs)
      .orderBy(desc(schema.grabs.updatedAt))
      .limit(limit)
      .all()
  }

  /** Sets a grab's state; used by the import plugin (`importing`, `imported`, `import_failed`). */
  setState(id: number, state: schema.GrabState, error?: string) {
    const grab = this.db
      .update(schema.grabs)
      .set({ state, error: error ?? null, updatedAt: this.now() })
      .where(eq(schema.grabs.id, id))
      .returning()
      .get()
    if (grab) this.ctx.emit('downloads/updated', grab)
    return grab
  }

  /** Polls every client once and updates all active grabs. */
  async monitor() {
    const active = this.active().filter(
      (g) => g.state !== 'import_pending' && g.state !== 'importing',
    )
    const byClient = new Map<string, schema.Grab[]>()
    for (const grab of active)
      byClient.set(grab.clientId, [...(byClient.get(grab.clientId) ?? []), grab])

    for (const [clientId, grabs] of byClient) {
      const entry = this.clients.get(clientId)
      if (!entry) continue // client disabled: leave its grabs alone until it's back
      let statuses: DownloadStatus[]
      try {
        statuses = await entry.client.list()
      } catch (error) {
        this.ctx.logger.warn('could not reach %s: %s', entry.options.name, error)
        continue
      }
      const byId = new Map(statuses.map((s) => [s.downloadId.toLowerCase(), s]))
      for (const grab of grabs) this.update(grab, byId.get(grab.downloadId))
    }
  }

  private update(grab: schema.Grab, status: DownloadStatus | undefined) {
    const now = this.now()
    if (!status) {
      if (now - grab.updatedAt > this.config.missingMinutes * 60_000) {
        this.fail(grab, 'removed from the download client', false)
      }
      return
    }
    const progressed = status.progress > grab.progress + 0.0001
    let state: schema.GrabState =
      status.state === 'completed'
        ? 'import_pending'
        : status.state === 'failed'
          ? 'failed'
          : status.state
    if (
      state === 'downloading' &&
      !progressed &&
      now - grab.lastProgressAt > this.config.stalledMinutes * 60_000
    ) {
      state = 'stalled'
    }
    if (state === 'failed')
      return this.fail(grab, status.error ?? 'download failed in the client', true)

    const updated = this.db
      .update(schema.grabs)
      .set({
        state,
        progress: status.progress,
        sizeBytes: status.sizeBytes ?? grab.sizeBytes,
        etaSeconds: status.etaSeconds ?? null,
        outputPath: status.outputPath ?? grab.outputPath,
        lastProgressAt: progressed ? now : grab.lastProgressAt,
        updatedAt: now,
      })
      .where(eq(schema.grabs.id, grab.id))
      .returning()
      .get()
    this.ctx.emit('downloads/updated', updated)
    if (state === 'import_pending' && grab.state !== 'import_pending')
      this.ctx.emit('downloads/completed', updated)
  }

  private fail(grab: schema.Grab, reason: string, blocklist: boolean) {
    if (blocklist) this.block(grab.mediaId, grab.release, reason)
    const failed = this.db
      .update(schema.grabs)
      .set({ state: 'failed', error: reason, updatedAt: this.now() })
      .where(eq(schema.grabs.id, grab.id))
      .returning()
      .get()
    this.ctx.logger.warn('download failed: %s (%s)', grab.title, reason)
    this.ctx.emit('downloads/updated', failed)
    this.ctx.emit('downloads/failed', failed)
  }

  /** Removes a grab from its client, optionally blocklisting the release. */
  async remove(id: number, options: { deleteData?: boolean; blocklist?: boolean } = {}) {
    const grab = this.get(id)
    if (!grab) return
    const entry = this.clients.get(grab.clientId)
    if (entry && !TERMINAL.includes(grab.state))
      await entry.client.remove(grab.downloadId, !!options.deleteData)
    if (options.blocklist) this.block(grab.mediaId, grab.release, 'removed by you')
    const removed = this.setState(id, 'removed')
    if (options.blocklist && removed) this.ctx.emit('downloads/failed', removed)
  }

  // ---- blocklist

  block(mediaId: number, release: ReleaseInfo, reason: string) {
    this.db
      .insert(schema.blocklist)
      .values({
        mediaId,
        title: release.title,
        infoHash: release.infoHash?.toLowerCase() ?? null,
        indexerId: release.indexerId,
        reason,
        createdAt: this.now(),
      })
      .run()
  }

  blocklisted(mediaId?: number) {
    const q = this.db.select().from(schema.blocklist)
    return (mediaId ? q.where(eq(schema.blocklist.mediaId, mediaId)) : q)
      .orderBy(desc(schema.blocklist.createdAt))
      .all()
  }

  unblock(id: number) {
    this.db.delete(schema.blocklist).where(eq(schema.blocklist.id, id)).run()
  }
}

export default DownloadsService
