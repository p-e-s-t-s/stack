// @magpiejs/notifications: tells people when something was imported, upgraded or failed.
// Notifier plugins (webhook, Discord, …) register a destination; this plugin turns Magpie's
// events into messages, sends each one as a job so it retries, and keeps a short activity
// log. Delivery is best effort: a crash can drop or repeat a message.

import type { Drizzle } from '@magpiejs/database'
import type { Grab } from '@magpiejs/downloads'
import type {} from '@magpiejs/downloads'
import type { MediaChange } from '@magpiejs/import'
import type {} from '@magpiejs/import'
import type {} from '@magpiejs/jobs'
import type { MediaItem } from '@magpiejs/library'
import type { NotificationEvent, Notifier, TestResult } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { desc, eq, lt } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    notifications: NotificationsService
  }
  interface Events {
    'notifications/changed'(): void
  }
}

/** Every event type, with whether a new destination gets it unless told otherwise. */
export const EVENT_TYPES = {
  'media.imported': 'A download was imported',
  'media.upgraded': 'A file was replaced by a better one',
  'import.failed': 'An import failed',
  'download.failed': 'A download failed',
  'download.grabbed': 'A release was sent to a download client',
} as const
export type EventType = keyof typeof EVENT_TYPES

const DAY = 24 * 60 * 60_000

export interface Config {
  /** How many days the activity log keeps. */
  retentionDays: number
}

interface SendPayload {
  logId: number
  notifierId: string
  event: NotificationEvent
}

export interface Destination {
  id: string
  name: string
  events: string[]
}

const label = (item: Pick<MediaItem, 'title' | 'year'>) =>
  item.year ? `${item.title} (${item.year})` : item.title

export class NotificationsService extends Service {
  static inject = ['database', 'jobs', 'library']

  db!: Drizzle<typeof schema>
  config: Config
  now = () => Date.now()
  private notifiers = new Map<string, { notifier: Notifier; name: string }>()

  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'notifications')
    this.config = { retentionDays: 30, ...config }
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'notifications',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define('notifications.send', (payload: SendPayload, { job, attempt, signal }) =>
      this.deliver(payload, attempt, job.maxAttempts, signal),
    )
    this.ctx.jobs.define('notifications.prune', async () => this.prune(), { maxAttempts: 1 })
    this.ctx.jobs.schedule('notifications.prune', 'notifications.prune', DAY)

    this.ctx.on('media/changed', (change) => this.onChanged(change))
    this.ctx.on('import/failed', (item, grab, reason) => {
      this.publish({
        type: 'import.failed',
        title: `Import failed: ${grab.title}`,
        body: reason,
        data: { kind: item?.kind, mediaId: grab.mediaId, release: grab.title },
      })
    })
    this.ctx.on('downloads/failed', (grab) => this.onDownload('download.failed', grab))
    this.ctx.on('downloads/grabbed', (grab) => this.onDownload('download.grabbed', grab))
    this.ctx.inject(['webui', 'timer'], (ctx) => void ctx.plugin(console_, this))
  }

  // ---- destinations

  /** Adds a destination for the lifetime of the calling plugin. */
  register(notifier: Notifier, options: { name: string }) {
    return this.ctx.effect(() => {
      if (this.notifiers.has(notifier.id))
        throw new Error(`notifier ${notifier.id} is already registered`)
      this.notifiers.set(notifier.id, { notifier, name: options.name })
      this.ctx.emit('notifications/changed')
      return () => {
        this.notifiers.delete(notifier.id)
        this.ctx.emit('notifications/changed')
      }
    }, `notifications.register(${options.name})`)
  }

  destinations(): Destination[] {
    return [...this.notifiers.values()].map(({ notifier, name }) => ({
      id: notifier.id,
      name,
      events: notifier.events,
    }))
  }

  /** Sends a test message now, outside the retry queue, and logs it. */
  async test(id: string): Promise<TestResult> {
    const entry = this.notifiers.get(id)
    if (!entry) return { ok: false, message: 'not running; check that it is enabled' }
    let result: TestResult
    try {
      result = await entry.notifier.test()
    } catch (error) {
      result = { ok: false, message: sanitize(error) }
    }
    const row = this.log({ type: 'test', title: 'Test message' }, id, entry.name)
    this.update(row, result.ok ? 'sent' : 'failed', 1, result.ok ? null : (result.message ?? null))
    return result
  }

  // ---- events

  private onChanged(change: MediaChange) {
    const { item } = change
    const files = change.added.length
    this.publish({
      type: change.replaced ? 'media.upgraded' : 'media.imported',
      title: `${change.replaced ? 'Upgraded' : 'Imported'}: ${label(item)}${change.version ? ` [${change.version}]` : ''}`,
      body: change.release,
      data: {
        kind: item.kind,
        mediaId: item.id,
        title: item.title,
        year: item.year,
        release: change.release,
        version: change.version,
        files,
        origin: change.origin,
      },
    })
  }

  private onDownload(type: 'download.failed' | 'download.grabbed', grab: Grab) {
    const item = this.ctx.library.get(grab.mediaId)
    const failed = type === 'download.failed'
    this.publish({
      type,
      title: `${failed ? 'Download failed' : 'Grabbed'}: ${grab.title}`,
      body: failed ? (grab.error ?? undefined) : item && label(item),
      data: { kind: item?.kind, mediaId: grab.mediaId, release: grab.title },
    })
  }

  /** Queues the event for every destination that wants it. */
  private publish(event: NotificationEvent) {
    for (const [id, { notifier, name }] of this.notifiers) {
      if (!notifier.events.includes(event.type)) continue
      const row = this.log(event, id, name)
      this.ctx.jobs.enqueue('notifications.send', {
        logId: row.id,
        notifierId: id,
        event,
      } satisfies SendPayload)
    }
    this.ctx.emit('notifications/changed')
  }

  private async deliver(
    payload: SendPayload,
    attempt: number,
    maxAttempts: number,
    signal: AbortSignal,
  ) {
    const entry = this.notifiers.get(payload.notifierId)
    if (!entry) {
      // removed or disabled since it was queued; there is nowhere to send it
      this.update(payload.logId, 'cancelled', attempt, 'the destination is gone or disabled')
      return
    }
    try {
      await entry.notifier.send(payload.event, { signal, deliveryId: String(payload.logId) })
    } catch (error) {
      const last = attempt >= maxAttempts
      this.update(payload.logId, last ? 'failed' : 'retrying', attempt, sanitize(error))
      throw error
    }
    this.update(payload.logId, 'sent', attempt, null)
  }

  // ---- activity log

  recent(limit = 50) {
    return this.db.select().from(schema.log).orderBy(desc(schema.log.id)).limit(limit).all()
  }

  private log(event: Pick<NotificationEvent, 'type' | 'title'>, id: string, name: string) {
    const now = this.now()
    return this.db
      .insert(schema.log)
      .values({
        event: event.type,
        title: event.title,
        notifierId: id,
        notifierName: name,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  }

  private update(
    row: number | { id: number },
    status: schema.LogEntry['status'],
    attempts: number,
    error: string | null,
  ) {
    const id = typeof row === 'number' ? row : row.id
    this.db
      .update(schema.log)
      .set({ status, attempts, error, updatedAt: this.now() })
      .where(eq(schema.log.id, id))
      .run()
    this.ctx.emit('notifications/changed')
  }

  prune() {
    this.db
      .delete(schema.log)
      .where(lt(schema.log.createdAt, this.now() - this.config.retentionDays * DAY))
      .run()
  }
}

/** Error text for the log and UI: one line, no URLs (they can carry tokens). */
export function sanitize(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/https?:\/\/\S+/g, '<url>')
    .split('\n')[0]!
    .slice(0, 300)
}

export default NotificationsService
