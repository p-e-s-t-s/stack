// @magpiejs/jobs: persisted job queue with retries and interval schedules
// (docs/PLAN.md §5.1, Phase 1).
//
// Jobs survive restarts because they live in SQLite. A job only runs while a plugin that
// defines its type is loaded; jobs of a disabled plugin wait until it's enabled again.

import { backoffDelay } from '@magpiejs/http-utils'
import { type Context, Service } from 'cordis'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import z from 'schemastery'
import type { Drizzle } from '@magpiejs/database'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    jobs: JobsService
  }
  interface Events {
    'jobs/done'(job: schema.Job): void
    'jobs/failed'(job: schema.Job, error: unknown): void
  }
}

export interface JobContext {
  job: schema.Job
  attempt: number
  /** Aborted when the plugin that defined the job type is disposed. */
  signal: AbortSignal
}

export type JobHandler<P = any> = (payload: P, context: JobContext) => Promise<void> | void

export interface DefineOptions {
  /** Total attempts including the first one. Default from config. */
  maxAttempts?: number
  /** Base retry delay; doubles each attempt. Default from config. */
  retryDelayMs?: number
}

export interface EnqueueOptions {
  /** Epoch milliseconds; defaults to now. */
  runAt?: number
  /** At most one pending or running job per key; enqueueing again returns the existing id. */
  dedupeKey?: string
  maxAttempts?: number
}

interface Definition {
  handler: JobHandler
  options: Required<DefineOptions>
  controllers: Set<AbortController>
}

export interface JobsConfig {
  pollInterval: number
  concurrency: number
  maxAttempts: number
  retryDelayMs: number
  lockMs: number
  retentionDays: number
}

export const JobsConfig: z<Partial<JobsConfig>, JobsConfig> = z.object({
  pollInterval: z
    .natural()
    .default(1000)
    .description('Milliseconds between queue polls; 0 disables polling.'),
  concurrency: z.natural().min(1).default(4).description('Jobs running at the same time.'),
  maxAttempts: z.natural().min(1).default(5).description('Default attempts per job.'),
  retryDelayMs: z.natural().default(30_000).description('Default base retry delay.'),
  lockMs: z
    .natural()
    .default(30 * 60_000)
    .description('A running job older than this is considered lost.'),
  retentionDays: z.natural().default(7).description('Days to keep finished jobs.'),
})

export class JobsService extends Service {
  static inject = ['database']
  static Config = JobsConfig

  config: JobsConfig
  db!: Drizzle<typeof schema>
  now = () => Date.now()

  private definitions = new Map<string, Definition>()
  private activeSchedules = new Set<string>()
  private running = new Map<number, Promise<void>>()

  constructor(ctx: Context, config: Partial<JobsConfig> = {}) {
    super(ctx, 'jobs')
    this.config = JobsConfig(config)
  }

  *[Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'jobs',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.recoverLost()
    if (this.config.pollInterval) {
      const timer = setInterval(() => void this.tick(), this.config.pollInterval)
      yield () => clearInterval(timer)
    }
    yield () => {
      for (const definition of this.definitions.values()) {
        for (const controller of definition.controllers) controller.abort()
      }
    }
  }

  /** Registers a handler for a job type for the lifetime of the calling plugin. */
  define<P = any>(type: string, handler: JobHandler<P>, options: DefineOptions = {}) {
    const caller = this.ctx
    return caller.effect(() => {
      if (this.definitions.has(type)) throw new Error(`job type ${type} is already defined`)
      const definition: Definition = {
        handler,
        controllers: new Set(),
        options: {
          maxAttempts: options.maxAttempts ?? this.config.maxAttempts,
          retryDelayMs: options.retryDelayMs ?? this.config.retryDelayMs,
        },
      }
      this.definitions.set(type, definition)
      return () => {
        for (const controller of definition.controllers) controller.abort()
        this.definitions.delete(type)
      }
    }, `jobs.define(${type})`)
  }

  enqueue<P = any>(type: string, payload?: P, options: EnqueueOptions = {}): number {
    const now = this.now()
    const values = {
      type,
      payload: payload ?? null,
      dedupeKey: options.dedupeKey ?? null,
      runAt: options.runAt ?? now,
      maxAttempts:
        options.maxAttempts ??
        this.definitions.get(type)?.options.maxAttempts ??
        this.config.maxAttempts,
      createdAt: now,
      updatedAt: now,
    }
    if (options.dedupeKey) {
      const existing = this.findActive(options.dedupeKey)
      if (existing) return existing.id
    }
    return this.db.insert(schema.queue).values(values).returning({ id: schema.queue.id }).get().id
  }

  /**
   * Runs `type` every `intervalMs` while the calling plugin is loaded. The schedule row
   * persists, so the next run time survives restarts; calling again updates the interval.
   */
  schedule<P = any>(name: string, type: string, intervalMs: number, payload?: P) {
    const caller = this.ctx
    return caller.effect(() => {
      if (this.activeSchedules.has(name)) throw new Error(`schedule ${name} is already active`)
      const now = this.now()
      this.db
        .insert(schema.schedules)
        .values({ name, type, intervalMs, payload: payload ?? null, nextRunAt: now + intervalMs })
        .onConflictDoUpdate({
          target: schema.schedules.name,
          set: {
            type,
            payload: payload ?? null,
            intervalMs,
            // an interval change takes effect relative to the last run
            nextRunAt: sql`coalesce(${schema.schedules.lastRunAt}, ${now}) + ${intervalMs}`,
          },
        })
        .run()
      this.activeSchedules.add(name)
      return () => this.activeSchedules.delete(name)
    }, `jobs.schedule(${name})`)
  }

  get(id: number) {
    return this.db.select().from(schema.queue).where(eq(schema.queue.id, id)).get()
  }

  list(options: { status?: schema.Job['status'][]; limit?: number } = {}) {
    const query = this.db.select().from(schema.queue)
    const filtered = options.status?.length
      ? query.where(inArray(schema.queue.status, options.status))
      : query
    return filtered
      .orderBy(asc(schema.queue.runAt), asc(schema.queue.id))
      .limit(options.limit ?? 100)
      .all()
  }

  /** One scheduler pass. Resolves when the jobs it started have finished. */
  async tick() {
    const now = this.now()
    this.fireSchedules(now)
    this.pruneFinished(now)

    const types = [...this.definitions.keys()]
    const slots = this.config.concurrency - this.running.size
    if (!types.length || slots <= 0) return

    const due = this.db
      .select()
      .from(schema.queue)
      .where(
        and(
          eq(schema.queue.status, 'pending'),
          lte(schema.queue.runAt, now),
          inArray(schema.queue.type, types),
        ),
      )
      .orderBy(asc(schema.queue.runAt), asc(schema.queue.id))
      .limit(slots)
      .all()

    const started: Promise<void>[] = []
    for (const job of due) {
      const claimed = this.db
        .update(schema.queue)
        .set({ status: 'running', lockUntil: now + this.config.lockMs, updatedAt: now })
        .where(and(eq(schema.queue.id, job.id), eq(schema.queue.status, 'pending')))
        .run()
      if (!claimed.changes) continue
      const task = this.execute({ ...job, status: 'running' }).finally(() =>
        this.running.delete(job.id),
      )
      this.running.set(job.id, task)
      started.push(task)
    }
    await Promise.all(started)
  }

  private async execute(job: schema.Job) {
    const definition = this.definitions.get(job.type)!
    const controller = new AbortController()
    definition.controllers.add(controller)
    const attempt = job.attempts + 1
    try {
      await definition.handler(job.payload, { job, attempt, signal: controller.signal })
      const done = this.finish(job.id, { status: 'done', attempts: attempt, lastError: null })
      this.ctx.emit('jobs/done', done)
    } catch (error) {
      if (controller.signal.aborted) {
        // plugin went away mid-run: put it back without spending an attempt
        this.finish(job.id, { status: 'pending', runAt: this.now() })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= job.maxAttempts) {
        const failed = this.finish(job.id, {
          status: 'failed',
          attempts: attempt,
          lastError: message,
        })
        this.ctx.emit('jobs/failed', failed, error)
      } else {
        const delay = backoffDelay(attempt, definition.options.retryDelayMs)
        this.finish(job.id, {
          status: 'pending',
          attempts: attempt,
          lastError: message,
          runAt: this.now() + delay,
        })
      }
    } finally {
      definition.controllers.delete(controller)
    }
  }

  private finish(id: number, values: Partial<schema.Job>) {
    return this.db
      .update(schema.queue)
      .set({ ...values, lockUntil: null, updatedAt: this.now() })
      .where(eq(schema.queue.id, id))
      .returning()
      .get()
  }

  private findActive(dedupeKey: string) {
    return this.db
      .select({ id: schema.queue.id })
      .from(schema.queue)
      .where(
        and(
          eq(schema.queue.dedupeKey, dedupeKey),
          inArray(schema.queue.status, ['pending', 'running']),
        ),
      )
      .get()
  }

  private fireSchedules(now: number) {
    if (!this.activeSchedules.size) return
    const due = this.db
      .select()
      .from(schema.schedules)
      .where(
        and(
          inArray(schema.schedules.name, [...this.activeSchedules]),
          lte(schema.schedules.nextRunAt, now),
        ),
      )
      .all()
    for (const schedule of due) {
      this.enqueue(schedule.type, schedule.payload, { dedupeKey: `schedule:${schedule.name}` })
      this.db
        .update(schema.schedules)
        .set({ lastRunAt: now, nextRunAt: now + schedule.intervalMs })
        .where(eq(schema.schedules.name, schedule.name))
        .run()
    }
  }

  /** Jobs left `running` by a crash go back to the queue. */
  private recoverLost() {
    const now = this.now()
    this.db
      .update(schema.queue)
      .set({ status: 'pending', lockUntil: null, runAt: now, updatedAt: now })
      .where(eq(schema.queue.status, 'running'))
      .run()
  }

  private pruneFinished(now: number) {
    const cutoff = now - this.config.retentionDays * 86_400_000
    this.db
      .delete(schema.queue)
      .where(
        and(inArray(schema.queue.status, ['done', 'failed']), lte(schema.queue.updatedAt, cutoff)),
      )
      .run()
  }
}

export default JobsService
