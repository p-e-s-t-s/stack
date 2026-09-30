import DatabaseService from '@magpiejs/database'
import JobsService from '@magpiejs/jobs'
import { Context, Service } from 'cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as system from '../src'
import type { SystemData } from '../src'

let entry: { mutate: ReturnType<typeof vi.fn> }
let added: { options: any; data: SystemData }[]
class FakeWebui extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webui')
  }
  addEntry(options: any, data: SystemData) {
    added.push({ options, data })
    return entry
  }
}

let ctx: Context
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  added = []
  entry = { mutate: vi.fn() }
  ctx = new Context()
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(FakeWebui)
})
afterEach(() => vi.useRealTimers())

it('serves uptime, job counts, recent failures and migration state on /system', async () => {
  ctx.jobs.define('ok', async () => {})
  ctx.jobs.define(
    'bad',
    async () => {
      throw new Error('kaput')
    },
    { maxAttempts: 1 },
  )
  ctx.jobs.enqueue('ok')
  ctx.jobs.enqueue('bad')
  ctx.jobs.enqueue('ok', undefined, { runAt: Date.now() + 3_600_000 })
  await ctx.jobs.tick()

  await ctx.plugin(system)
  const { options, data } = added[0]!
  expect(options.routes).toEqual(['/system'])
  expect(data.startedAt).toBeLessThanOrEqual(data.now)
  expect(data.jobs).toEqual({ done: 1, failed: 1, pending: 1 })
  expect(data.failed).toMatchObject([{ type: 'bad', error: 'kaput' }])
  expect(data.namespaces).toContainEqual({
    namespace: 'jobs',
    active: true,
    migrations: expect.any(Number),
  })
})

it('refreshes the snapshot every five seconds and stops with the plugin', async () => {
  const fiber = await ctx.plugin(system)
  vi.advanceTimersByTime(4_999)
  expect(entry.mutate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(entry.mutate).toHaveBeenCalledTimes(1)

  ctx.jobs.define('later', async () => {})
  ctx.jobs.enqueue('later', undefined, { runAt: Date.now() + 3_600_000 })
  const data = { jobs: {} } as SystemData
  entry.mutate.mock.calls[0]![0](data)
  expect(data.jobs).toEqual({ pending: 1 })

  await fiber.dispose()
  vi.advanceTimersByTime(20_000)
  expect(entry.mutate).toHaveBeenCalledTimes(1)
})
