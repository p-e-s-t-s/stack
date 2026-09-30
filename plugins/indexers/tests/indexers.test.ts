import DatabaseService from '@magpiejs/database'
import JobsService from '@magpiejs/jobs'
import type { IndexerProvider, ReleaseInfo } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import IndexersService from '../src'

const MINUTE = 60_000
const release = (guid: string): ReleaseInfo => ({
  guid,
  title: guid,
  protocol: 'torrent',
  indexerId: 'x',
  downloadUrl: `magnet:?xt=urn:btih:${guid}`,
  size: 1,
})

let ctx: Context
let clock: number
let searchImpl: () => Promise<ReleaseInfo[]>
let feed: ReleaseInfo[]
const options = {
  name: 'Fake',
  priority: 3,
  enableRss: true,
  enableAutomatic: true,
  enableInteractive: true,
}
const provider = (id = 'fake'): IndexerProvider => ({
  id,
  protocol: 'torrent',
  capabilities: async () => ({
    categories: [],
    searchParams: { movie: [], tv: [], search: ['q'] },
  }),
  search: () => searchImpl(),
  rss: async () => feed,
  test: async () => ({ ok: true, message: 'fine' }),
})

beforeEach(async () => {
  clock = 1_000_000
  feed = []
  searchImpl = async () => [release('a')]
  ctx = new Context()
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(IndexersService)
  ctx.indexers.now = () => clock
})

describe('search', () => {
  it('tags releases with the indexer that returned them', async () => {
    ctx.indexers.register(provider(), options)
    const { releases, errors } = await ctx.indexers.search({ kind: 'movie', title: 'x' } as any)
    expect(errors).toEqual([])
    expect(releases).toMatchObject([
      { guid: 'a', indexerId: 'fake', indexerName: 'Fake', indexerPriority: 3 },
    ])
  })

  it('reports failures instead of throwing, and backs off with growing delays', async () => {
    searchImpl = async () => {
      throw new Error('boom')
    }
    ctx.indexers.register(provider(), options)
    const query = { kind: 'movie', title: 'x' } as any

    expect((await ctx.indexers.search(query)).errors).toEqual([
      { indexer: 'Fake', message: 'boom' },
    ])
    let health = ctx.indexers.health()[0]!
    expect(health).toMatchObject({ healthy: false, failures: 1, lastError: 'boom' })
    expect(health.disabledUntil).toBe(clock + 5 * MINUTE)

    // skipped while backing off, but interactive searches still run
    expect((await ctx.indexers.search(query)).errors).toEqual([])
    expect((await ctx.indexers.search(query, 'interactive')).errors).toHaveLength(1)
    expect(ctx.indexers.health()[0]!.failures).toBe(2)
    expect(ctx.indexers.health()[0]!.disabledUntil).toBe(clock + 15 * MINUTE)

    clock += 16 * MINUTE
    expect(ctx.indexers.health()[0]!.healthy).toBe(true)
    expect((await ctx.indexers.search(query)).errors).toHaveLength(1)
    expect(ctx.indexers.health()[0]!.disabledUntil).toBe(clock + 30 * MINUTE)

    // a success clears the slate
    searchImpl = async () => [release('a')]
    clock += 31 * MINUTE
    await ctx.indexers.search(query)
    health = ctx.indexers.health()[0]!
    expect(health).toMatchObject({
      healthy: true,
      failures: 0,
      lastError: null,
      lastSuccessAt: clock,
    })
  })

  it('caps the backoff at six hours', () => {
    ctx.indexers.register(provider(), options)
    for (let i = 0; i < 10; i++) ctx.indexers.failed('fake', 'x')
    expect(ctx.indexers.health()[0]!.disabledUntil).toBe(clock + 360 * MINUTE)
  })

  it('times out a slow indexer', async () => {
    ctx.indexers.timeout = 10
    searchImpl = () => new Promise(() => {})
    ctx.indexers.register(provider(), options)
    const { errors } = await ctx.indexers.search({ kind: 'movie', title: 'x' } as any)
    expect(errors[0]!.message).toMatch(/timed out/)
  })

  it('honours the per-indexer enable flags', () => {
    ctx.indexers.register(provider('a'), { ...options, enableRss: false })
    ctx.indexers.register(provider('b'), { ...options, enableAutomatic: false })
    ctx.indexers.register(provider('c'), { ...options, enableInteractive: false })
    const ids = (kind: 'rss' | 'automatic' | 'interactive') =>
      ctx.indexers.usable(kind).map(([id]) => id)
    expect(ids('rss')).toEqual(['b', 'c'])
    expect(ids('automatic')).toEqual(['a', 'c'])
    expect(ids('interactive')).toEqual(['a', 'b'])
  })
})

describe('registry', () => {
  it('refuses duplicates and forgets indexers with their plugin', async () => {
    let changes = 0
    ctx.on('indexers/changed', () => void changes++)
    const fiber = await ctx.plugin({
      name: 'fake',
      inject: ['indexers'],
      apply: (c: Context) => void c.indexers.register(provider(), options),
    })
    expect(ctx.indexers.get('fake')).toBeDefined()
    expect(() => ctx.indexers.register(provider(), options)).toThrow(/already registered/)
    await fiber.dispose()
    expect(ctx.indexers.get('fake')).toBeUndefined()
    expect(changes).toBe(2)
  })

  it('tests one indexer, with failures and unknown ids as results', async () => {
    ctx.indexers.register(provider(), options)
    expect(await ctx.indexers.test('fake')).toEqual({ ok: true, message: 'fine' })
    expect(await ctx.indexers.test('nope')).toEqual({ ok: false, message: 'indexer not found' })
  })

  it('falls back to a plain text search for kinds nobody described', () => {
    expect(ctx.indexers.searchTypeOf('movie')).toEqual({ mode: 'search', defaultCategories: [] })
    const type = { mode: 'movie', defaultCategories: [2000] } as any
    ctx.indexers.searchType('movie', type)
    expect(ctx.indexers.searchTypeOf('movie')).toBe(type)
    expect(ctx.indexers.searchKinds()).toEqual([['movie', type]])
  })
})

describe('rss', () => {
  it('announces only releases newer than the last one seen', async () => {
    const seen: string[][] = []
    ctx.on('indexers/rss', (releases) => void seen.push(releases.map((r) => r.guid)))
    ctx.indexers.register(provider(), options)

    feed = [release('c'), release('b'), release('a')]
    expect((await ctx.indexers.syncRss()).map((r) => r.guid)).toEqual(['c', 'b', 'a'])

    feed = [release('e'), release('d'), release('c'), release('b'), release('a')]
    expect((await ctx.indexers.syncRss()).map((r) => r.guid)).toEqual(['e', 'd'])

    expect(await ctx.indexers.syncRss()).toEqual([]) // nothing new: no event
    expect(seen).toEqual([
      ['c', 'b', 'a'],
      ['e', 'd'],
    ])
  })

  it('counts a failing feed against the indexer', async () => {
    ctx.indexers.register(
      { ...provider(), rss: async () => Promise.reject(new Error('feed down')) },
      options,
    )
    await ctx.indexers.syncRss()
    expect(ctx.indexers.health()[0]).toMatchObject({ failures: 1, lastError: 'feed down' })
  })
})
