import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queue } from '@magpiejs/jobs/schema'
import { rootFolders } from '@magpiejs/library/schema'
import { createTestContext } from '@magpiejs/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HealthService from '../src'

let dir: string
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'magpie-health-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function boot(config = {}) {
  const ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(HealthService, config)
  return ctx
}
const find = (ctx: Awaited<ReturnType<typeof boot>>, name: string) =>
  ctx.health.list().find((c) => c.name === name)!

describe('health service', () => {
  it('lists checks as not checked until they have run, then keeps each result', async () => {
    const ctx = await boot()
    ctx.health.check('mine', () => ({ level: 'warning', message: 'hmm', details: ['a', 'b'] }), {
      label: 'Mine',
      link: '/settings/x',
    })
    expect(find(ctx, 'mine')).toMatchObject({ level: 'unknown', label: 'Mine', checkedAt: null })
    await ctx.health.run('mine')
    expect(find(ctx, 'mine')).toMatchObject({
      level: 'warning',
      message: 'hmm',
      details: ['a', 'b'],
      link: '/settings/x',
    })
    expect(find(ctx, 'mine').checkedAt).toBeGreaterThan(0)
  })

  it('reports the worst level, ignoring checks that have not run', async () => {
    const ctx = await boot()
    const before = ctx.health.level()
    ctx.health.check('a', () => ({ level: 'ok', message: '' }))
    ctx.health.check('b', () => ({ level: 'error', message: 'bad' }))
    expect(ctx.health.level()).toBe(before)
    await ctx.health.run()
    expect(ctx.health.level()).toBe('error')
  })

  it('turns a throwing or slow check into an error instead of failing the pass', async () => {
    const ctx = await boot()
    ctx.health.config.timeoutSeconds = 0.05
    ctx.health.check('throws', () => {
      throw new Error('boom')
    })
    ctx.health.check('slow', () => new Promise(() => {}))
    ctx.health.check('fine', () => ({ level: 'ok', message: 'fine' }))
    await ctx.health.run()
    expect(find(ctx, 'throws')).toMatchObject({
      level: 'error',
      message: expect.stringContaining('boom'),
    })
    expect(find(ctx, 'slow')).toMatchObject({
      level: 'error',
      message: expect.stringContaining('took longer'),
    })
    expect(find(ctx, 'fine').level).toBe('ok')
  })

  it('drops a check with the plugin that registered it and announces changes', async () => {
    const ctx = await boot()
    let changes = 0
    ctx.on('health/changed', () => void changes++)
    const other = await ctx.plugin((inner) => {
      inner.inject(['health'], (c) => c.health.check('temp', () => ({ level: 'ok', message: '' })))
    })
    expect(find(ctx, 'temp')).toBeTruthy()
    await other.dispose()
    expect(ctx.health.list().some((c) => c.name === 'temp')).toBe(false)
    expect(changes).toBeGreaterThan(1)
  })

  it('refuses two checks of one name and running one that does not exist', async () => {
    const ctx = await boot()
    ctx.health.check('dup', () => ({ level: 'ok', message: '' }))
    expect(() => ctx.health.check('dup', () => ({ level: 'ok', message: '' }))).toThrow('already')
    await expect(ctx.health.run('nope')).rejects.toThrow('no health check')
  })

  it('runs from a scheduled job', async () => {
    const ctx = await boot()
    ctx.health.check('x', () => ({ level: 'ok', message: 'x' }))
    ctx.jobs.enqueue('health.run')
    await ctx.jobs.tick()
    expect(find(ctx, 'x').level).toBe('ok')
  })
})

describe('built-in checks', () => {
  it('database integrity passes on a healthy database', async () => {
    const ctx = await boot()
    await ctx.health.run('database')
    expect(find(ctx, 'database').level).toBe('ok')
  })

  it('warns about jobs that failed in the last day, and forgets older ones', async () => {
    const ctx = await boot()
    const now = Date.now()
    const job = (updatedAt: number) => ({
      type: 'thing.run',
      payload: null,
      status: 'failed' as const,
      lastError: 'it broke',
      runAt: updatedAt,
      maxAttempts: 1,
      createdAt: updatedAt,
      updatedAt,
    })
    ctx.jobs.db
      .insert(queue)
      .values(job(now - 3 * 86_400_000))
      .run()
    await ctx.health.run('jobs')
    expect(find(ctx, 'jobs').level).toBe('ok')
    ctx.jobs.db
      .insert(queue)
      .values(job(now - 1000))
      .run()
    await ctx.health.run('jobs')
    expect(find(ctx, 'jobs')).toMatchObject({ level: 'warning', details: ['thing.run: it broke'] })
  })

  it('root folders: missing and read-only are errors, a normal one is fine', async () => {
    const ctx = await boot()
    await ctx.health.run('root-folders')
    expect(find(ctx, 'root-folders').level).toBe('ok') // none set up

    const good = join(dir, 'movies')
    mkdirSync(good)
    ctx.library.addRootFolder(good, 'movie')
    await ctx.health.run('root-folders')
    expect(find(ctx, 'root-folders').level).toBe('ok')

    // added straight to the table: addRootFolder would create the folder
    const file = join(dir, 'file')
    writeFileSync(file, '')
    ctx.library.db
      .insert(rootFolders)
      .values([
        { path: join(dir, 'gone'), kind: 'series' },
        { path: file, kind: 'music' },
      ])
      .run()
    await ctx.health.run('root-folders')
    const status = find(ctx, 'root-folders')
    expect(status.level).toBe('error')
    expect(status.details).toHaveLength(2)
    expect(status.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('gone (series) does not exist'),
        expect.stringContaining('(music) is not a folder'),
      ]),
    )
  })

  it('root folders: warns when space is low', async () => {
    const ctx = await boot({ minFreeGb: 1_000_000_000 })
    mkdirSync(join(dir, 'm'))
    ctx.library.addRootFolder(join(dir, 'm'), 'movie')
    await ctx.health.run('root-folders')
    expect(['warning', 'error']).toContain(find(ctx, 'root-folders').level)
    expect(find(ctx, 'root-folders').details?.[0]).toContain('GB free')
  })

  it('indexers: none is a warning; a failing one is named', async () => {
    const ctx = await boot()
    await ctx.health.run('indexers')
    expect(find(ctx, 'indexers').level).toBe('warning')
    ctx.indexers.register(
      {
        id: 'good',
        protocol: 'torrent',
        search: async () => [],
        rss: async () => [],
        test: async () => ({ ok: true }),
      } as never,
      {
        name: 'Good',
        priority: 25,
        enableRss: true,
        enableAutomatic: true,
        enableInteractive: true,
      },
    )
    ctx.indexers.register(
      {
        id: 'flaky',
        protocol: 'torrent',
        search: async () => [],
        rss: async () => [],
        test: async () => ({ ok: true }),
      } as never,
      {
        name: 'Flaky',
        priority: 25,
        enableRss: true,
        enableAutomatic: true,
        enableInteractive: true,
      },
    )
    await ctx.health.run('indexers')
    expect(find(ctx, 'indexers').level).toBe('ok')
    const flaky = ctx.indexers.health().find((i) => i.name === 'Flaky')!
    ctx.indexers.failed(flaky.id, 'HTTP 503')
    await ctx.health.run('indexers')
    expect(find(ctx, 'indexers')).toMatchObject({
      level: 'warning',
      details: ['Flaky: HTTP 503'],
    })
    ctx.indexers.failed(ctx.indexers.health().find((i) => i.name === 'Good')!.id, 'HTTP 500')
    await ctx.health.run('indexers')
    expect(find(ctx, 'indexers').level).toBe('error')
  })

  it('download clients: none is a warning; an unreachable one is an error', async () => {
    const ctx = await boot()
    await ctx.health.run('download-clients')
    expect(find(ctx, 'download-clients').level).toBe('warning')
    let up = true
    ctx.downloads.register(
      {
        id: 'c1',
        protocol: 'torrent',
        test: async () => (up ? { ok: true } : { ok: false, message: 'connection refused' }),
      } as never,
      { name: 'qBit', priority: 1, category: 'magpie' },
    )
    await ctx.health.run('download-clients')
    expect(find(ctx, 'download-clients').level).toBe('ok')
    up = false
    await ctx.health.run('download-clients')
    expect(find(ctx, 'download-clients')).toMatchObject({
      level: 'error',
      details: ['qBit: connection refused'],
    })
  })
})
