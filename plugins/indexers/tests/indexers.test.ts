import type { IndexerProvider, ReleaseInfo } from '@magpiejs/types'
import { createTestContext } from '@magpiejs/testing'
import { describe, expect, it } from 'vitest'

const MINUTE = 60_000

const release = (guid: string): ReleaseInfo => ({
  guid,
  title: `Release ${guid}`,
  protocol: 'torrent',
  indexerId: 'ignored',
  downloadUrl: `https://dl/${guid}`,
})

interface FakeOptions {
  search?: () => Promise<ReleaseInfo[]>
  rss?: () => Promise<ReleaseInfo[]>
}
const fake = (id: string, { search, rss }: FakeOptions = {}): IndexerProvider => ({
  id,
  protocol: 'torrent',
  capabilities: async () => ({}) as never,
  search: search ?? (async () => []),
  ...(rss && { rss }),
  test: async () => ({ ok: true, message: 'fine' }),
})

const OPTIONS = {
  priority: 25,
  enableRss: true,
  enableAutomatic: true,
  enableInteractive: true,
}

async function boot() {
  const ctx = await createTestContext({ metadata: false, calendar: false })
  let now = 1_000_000
  ctx.indexers.now = () => now
  return { ctx, advance: (ms: number) => void (now += ms) }
}

describe('registration', () => {
  it('rejects a duplicate id and unregisters on dispose', async () => {
    const { ctx } = await boot()
    let changes = 0
    ctx.on('indexers/changed', () => void changes++)
    const dispose = ctx.indexers.register(fake('a'), { name: 'A', ...OPTIONS })
    expect(() => ctx.indexers.register(fake('a'), { name: 'A2', ...OPTIONS })).toThrow(
      'already registered',
    )
    dispose()
    expect(ctx.indexers.get('a')).toBeUndefined()
    expect(changes).toBe(2)
  })

  it('says how a kind is searched, defaulting to plain text', async () => {
    const { ctx } = await boot()
    expect(ctx.indexers.searchTypeOf('movie')).toEqual({ mode: 'search', defaultCategories: [] })
    const type = { mode: 'movie', defaultCategories: [2000] } as never
    ctx.indexers.searchType('movie', type)
    expect(ctx.indexers.searchTypeOf('movie')).toBe(type)
  })
})

describe('search', () => {
  it('fans out, tags releases with their indexer, and reports failures without throwing', async () => {
    const { ctx } = await boot()
    ctx.indexers.register(fake('good', { search: async () => [release('1')] }), {
      name: 'Good',
      ...OPTIONS,
      priority: 5,
    })
    ctx.indexers.register(
      fake('bad', {
        search: async () => {
          throw new Error('503')
        },
      }),
      { name: 'Bad', ...OPTIONS },
    )
    const outcome = await ctx.indexers.search({ kind: 'movie', term: 'x' })
    expect(outcome.releases).toMatchObject([
      { guid: '1', indexerId: 'good', indexerName: 'Good', indexerPriority: 5 },
    ])
    expect(outcome.errors).toEqual([{ indexer: 'Bad', message: '503' }])
  })

  it('only searches indexers enabled for that kind of search', async () => {
    const { ctx } = await boot()
    const calls: string[] = []
    const track = (id: string) => async () => {
      calls.push(id)
      return []
    }
    ctx.indexers.register(fake('auto', { search: track('auto') }), {
      name: 'Auto',
      ...OPTIONS,
      enableInteractive: false,
    })
    ctx.indexers.register(fake('manual', { search: track('manual') }), {
      name: 'Manual',
      ...OPTIONS,
      enableAutomatic: false,
    })
    await ctx.indexers.search({ kind: 'movie' }, 'automatic')
    await ctx.indexers.search({ kind: 'movie' }, 'interactive')
    expect(calls).toEqual(['auto', 'manual'])
  })

  it('times out a slow indexer', async () => {
    const { ctx } = await boot()
    ctx.indexers.timeout = 20
    ctx.indexers.register(fake('slow', { search: () => new Promise(() => {}) }), {
      name: 'Slow',
      ...OPTIONS,
    })
    const outcome = await ctx.indexers.search({ kind: 'movie' })
    expect(outcome.errors).toEqual([{ indexer: 'Slow', message: 'timed out after 0.02 s' }])
  })
})

describe('health and backoff', () => {
  const failing = () =>
    fake('f', {
      search: async () => {
        throw new Error('down')
      },
    })

  it('backs off 5, 15, 30, 60, 180 then 360 minutes, staying at the last step', async () => {
    const { ctx } = await boot()
    ctx.indexers.register(failing(), { name: 'F', ...OPTIONS })
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      await ctx.indexers.search({ kind: 'movie' }, 'interactive') // interactive ignores the backoff
      const h = ctx.indexers.health()[0]!
      delays.push((h.disabledUntil! - 1_000_000) / MINUTE)
      expect(h.failures).toBe(i + 1)
    }
    expect(delays).toEqual([5, 15, 30, 60, 180, 360, 360])
  })

  it('skips an indexer in backoff for automatic searches until the backoff ends', async () => {
    const { ctx, advance } = await boot()
    let calls = 0
    ctx.indexers.register(
      fake('f', {
        search: async () => {
          calls++
          throw new Error('down')
        },
      }),
      { name: 'F', ...OPTIONS },
    )
    await ctx.indexers.search({ kind: 'movie' })
    expect(ctx.indexers.health()[0]).toMatchObject({ healthy: false, lastError: 'down' })
    await ctx.indexers.search({ kind: 'movie' })
    expect(calls).toBe(1)
    advance(5 * MINUTE + 1)
    expect(ctx.indexers.health()[0]?.healthy).toBe(true)
    await ctx.indexers.search({ kind: 'movie' })
    expect(calls).toBe(2)
  })

  it('clears the failure state after a success', async () => {
    const { ctx, advance } = await boot()
    let fail = true
    ctx.indexers.register(
      fake('f', { search: async () => (fail ? Promise.reject(new Error('down')) : []) }),
      { name: 'F', ...OPTIONS },
    )
    await ctx.indexers.search({ kind: 'movie' })
    fail = false
    advance(6 * MINUTE)
    await ctx.indexers.search({ kind: 'movie' })
    expect(ctx.indexers.health()[0]).toMatchObject({
      healthy: true,
      failures: 0,
      disabledUntil: null,
      lastError: null,
      lastSuccessAt: 1_000_000 + 6 * MINUTE,
    })
  })

  it('tests an indexer without touching its health, and reports unknown ids and throws', async () => {
    const { ctx } = await boot()
    ctx.indexers.register(fake('ok'), { name: 'OK', ...OPTIONS })
    ctx.indexers.register(
      { ...fake('boom'), test: async () => Promise.reject(new Error('nope')) },
      { name: 'Boom', ...OPTIONS },
    )
    expect(await ctx.indexers.test('ok')).toEqual({ ok: true, message: 'fine' })
    expect(await ctx.indexers.test('boom')).toEqual({ ok: false, message: 'nope' })
    expect(await ctx.indexers.test('missing')).toEqual({ ok: false, message: 'indexer not found' })
    expect(ctx.indexers.health().map((h) => h.failures)).toEqual([0, 0])
  })
})

describe('rss sync', () => {
  it('announces only releases newer than the last one seen', async () => {
    const { ctx } = await boot()
    let feed = ['c', 'b', 'a'].map(release)
    ctx.indexers.register(fake('r', { rss: async () => feed }), { name: 'R', ...OPTIONS })
    const announced: string[][] = []
    ctx.on('indexers/rss', (releases) => void announced.push(releases.map((r) => r.guid)))

    expect((await ctx.indexers.syncRss()).map((r) => r.guid)).toEqual(['c', 'b', 'a']) // first run: all
    expect(await ctx.indexers.syncRss()).toEqual([]) // nothing new
    feed = ['e', 'd', 'c', 'b', 'a'].map(release)
    expect((await ctx.indexers.syncRss()).map((r) => r.guid)).toEqual(['e', 'd'])
    expect(announced).toEqual([
      ['c', 'b', 'a'],
      ['e', 'd'],
    ])
  })

  it('treats a feed that no longer contains the last guid as all new', async () => {
    const { ctx } = await boot()
    let feed = ['b', 'a'].map(release)
    ctx.indexers.register(fake('r', { rss: async () => feed }), { name: 'R', ...OPTIONS })
    await ctx.indexers.syncRss()
    feed = ['z', 'y'].map(release)
    expect((await ctx.indexers.syncRss()).map((r) => r.guid)).toEqual(['z', 'y'])
  })

  it('skips indexers without RSS or with RSS disabled, and records feed failures', async () => {
    const { ctx } = await boot()
    ctx.indexers.register(fake('no-rss'), { name: 'NoRss', ...OPTIONS })
    ctx.indexers.register(fake('off', { rss: async () => [release('x')] }), {
      name: 'Off',
      ...OPTIONS,
      enableRss: false,
    })
    ctx.indexers.register(fake('broken', { rss: () => Promise.reject(new Error('bad feed')) }), {
      name: 'Broken',
      ...OPTIONS,
    })
    expect(await ctx.indexers.syncRss()).toEqual([])
    expect(ctx.indexers.health().find((h) => h.id === 'broken')).toMatchObject({
      failures: 1,
      lastError: 'bad feed',
    })
  })
})
