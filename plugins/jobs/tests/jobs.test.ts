import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DatabaseService from '@magpiejs/database'
import JobsService from '../src'

let ctx: Context
let clock: number

const withJobs = (apply: (ctx: Context) => void) => ({ inject: ['jobs'], apply })

async function start(config = {}) {
  await ctx.plugin(JobsService, { pollInterval: 0, retryDelayMs: 1000, ...config })
  ctx.jobs.now = () => clock
}

beforeEach(async () => {
  clock = 1_000_000
  ctx = new Context()
  await ctx.plugin(DatabaseService, { path: ':memory:' })
})

afterEach(async () => {
  await ctx.registry.delete(DatabaseService)
})

describe('JobsService', () => {
  it('runs due jobs and records the result', async () => {
    await start()
    const seen: unknown[] = []
    await ctx.plugin(
      withJobs((ctx: Context) => {
        ctx.jobs.define('echo', (payload) => void seen.push(payload))
      }),
    )
    const id = ctx.jobs.enqueue('echo', { hello: 'world' })
    await ctx.jobs.tick()
    expect(seen).toEqual([{ hello: 'world' }])
    expect(ctx.jobs.get(id)).toMatchObject({ status: 'done', attempts: 1 })
  })

  it('waits until runAt', async () => {
    await start()
    let runs = 0
    await ctx.plugin(withJobs((ctx: Context) => void ctx.jobs.define('later', () => void runs++)))
    ctx.jobs.enqueue('later', null, { runAt: clock + 5000 })
    await ctx.jobs.tick()
    expect(runs).toBe(0)
    clock += 5000
    await ctx.jobs.tick()
    expect(runs).toBe(1)
  })

  it('retries with backoff and fails after maxAttempts', async () => {
    await start()
    const failures: unknown[] = []
    ctx.on('jobs/failed', (job) => void failures.push(job.id))
    await ctx.plugin(
      withJobs((ctx: Context) => {
        ctx.jobs.define(
          'flaky',
          () => {
            throw new Error('boom')
          },
          { maxAttempts: 2 },
        )
      }),
    )
    const id = ctx.jobs.enqueue('flaky')
    await ctx.jobs.tick()
    const retried = ctx.jobs.get(id)!
    expect(retried).toMatchObject({ status: 'pending', attempts: 1, lastError: 'boom' })
    expect(retried.runAt).toBeGreaterThan(clock)

    clock = retried.runAt
    await ctx.jobs.tick()
    expect(ctx.jobs.get(id)).toMatchObject({ status: 'failed', attempts: 2 })
    expect(failures).toEqual([id])
  })

  it('deduplicates pending jobs by key', async () => {
    await start()
    const a = ctx.jobs.enqueue('search', { id: 1 }, { dedupeKey: 'search:1' })
    const b = ctx.jobs.enqueue('search', { id: 1 }, { dedupeKey: 'search:1' })
    expect(b).toBe(a)
    expect(ctx.jobs.list()).toHaveLength(1)
  })

  it('leaves jobs of a disabled plugin queued until it comes back', async () => {
    await start()
    let runs = 0
    const plugin = withJobs((ctx: Context) => void ctx.jobs.define('scan', () => void runs++))
    const fiber = await ctx.plugin(plugin)
    await fiber.dispose()
    const id = ctx.jobs.enqueue('scan')
    await ctx.jobs.tick()
    expect(ctx.jobs.get(id)?.status).toBe('pending')

    await ctx.plugin(plugin)
    await ctx.jobs.tick()
    expect(runs).toBe(1)
  })

  it('fires schedules only while their plugin is loaded, and keeps the next run time', async () => {
    await start()
    let runs = 0
    const plugin = withJobs((ctx: Context) => {
      ctx.jobs.define('rss', () => void runs++)
      ctx.jobs.schedule('rss-sync', 'rss', 60_000)
    })
    const fiber = await ctx.plugin(plugin)
    await ctx.jobs.tick()
    expect(runs).toBe(0)
    clock += 60_000
    await ctx.jobs.tick() // enqueues
    await ctx.jobs.tick() // runs
    expect(runs).toBe(1)

    await fiber.dispose()
    clock += 120_000
    await ctx.jobs.tick()
    expect(ctx.jobs.list({ status: ['pending'] })).toHaveLength(0)
  })

  it('puts a job back without spending an attempt when its plugin is disposed mid-run', async () => {
    await start()
    let release!: () => void
    const plugin = withJobs((ctx: Context) => {
      ctx.jobs.define('slow', (_, { signal }) => {
        return new Promise<void>((resolve, reject) => {
          release = resolve
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
    })
    const fiber = await ctx.plugin(plugin)
    const id = ctx.jobs.enqueue('slow')
    const tick = ctx.jobs.tick()
    await new Promise((r) => setTimeout(r, 10))
    await fiber.dispose()
    await tick
    expect(ctx.jobs.get(id)).toMatchObject({ status: 'pending', attempts: 0 })
    void release
  })

  it('requeues jobs left running by a crash', async () => {
    await start()
    const id = ctx.jobs.enqueue('x')
    ctx.database.sqlite.prepare(`UPDATE jobs_queue SET status = 'running' WHERE id = ?`).run(id)
    await ctx.registry.delete(JobsService)
    await start()
    expect(ctx.jobs.get(id)?.status).toBe('pending')
  })
})
