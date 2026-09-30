import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import MediaServers, { type ChangedPath, type MediaServerProvider } from '../src'
import { optionsOf } from '../src/config'

let ctx: Context
let clock: number

function fake(id: string, failures = 0) {
  const batches: ChangedPath[][] = []
  let left = failures
  const provider: MediaServerProvider = {
    id,
    async test() {
      return { ok: true }
    },
    async libraries() {
      return [{ name: 'Movies', paths: ['/media/movies'] }]
    },
    async refresh(paths) {
      if (left-- > 0) throw new Error('HTTP 503')
      batches.push(paths)
    },
  }
  return { provider, batches }
}

const options = (extra: Partial<ReturnType<typeof optionsOf>> = {}) => ({
  name: 'Server',
  kinds: [],
  mappings: [],
  debounceMs: 15_000,
  ...extra,
})

const change = (added: string[], removed: string[] = [], kind = 'movie') =>
  ctx.emit('media/changed', {
    origin: 'download',
    item: { id: 1, kind, title: 'T', year: null } as never,
    added,
    removed,
    replaced: removed.length > 0,
  })

beforeEach(async () => {
  clock = 1_000_000
  ctx = await createTestContext({ metadata: false, calendar: false })
  ctx.jobs.now = () => clock
  await ctx.plugin(MediaServers)
  ctx.mediaServers.now = () => clock
})

describe('media servers', () => {
  it('batches several imports into one request, removed files included', async () => {
    const s = fake('plex:a')
    ctx.mediaServers.register(s.provider, options())
    change(['/m/A/a.mkv'])
    change(['/m/B/b.mkv'], ['/m/B/old.mkv'])
    expect(ctx.mediaServers.list()[0]!.pending).toBe(3)
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(s.batches).toEqual([
      [
        { path: '/m/A/a.mkv', change: 'added' },
        { path: '/m/B/b.mkv', change: 'added' },
        { path: '/m/B/old.mkv', change: 'removed' },
      ],
    ])
    expect(ctx.mediaServers.list()[0]).toMatchObject({ pending: 0, lastAcceptedAt: clock })
  })

  it('does not lose changes that arrive after a batch is taken', async () => {
    const s = fake('plex:a')
    ctx.mediaServers.register(s.provider, options())
    change(['/m/A/a.mkv'])
    ctx.mediaServers.flush()
    change(['/m/B/b.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(s.batches.map((b) => b.map((p) => p.path))).toEqual([['/m/A/a.mkv'], ['/m/B/b.mkv']])
  })

  it('flushes on its own after the debounce', async () => {
    const s = fake('plex:a')
    ctx.mediaServers.register(s.provider, options({ debounceMs: 20 }))
    change(['/m/A/a.mkv'])
    await new Promise((resolve) => setTimeout(resolve, 80))
    await ctx.jobs.tick()
    expect(s.batches).toHaveLength(1)
  })

  it('stops waiting at the maximum wait while imports keep arriving', async () => {
    const s = fake('plex:a')
    ctx.mediaServers.register(s.provider, options())
    change(['/m/A/a.mkv'])
    clock += 61_000
    change(['/m/B/b.mkv'])
    await ctx.jobs.tick()
    expect(s.batches).toHaveLength(1)
    expect(ctx.mediaServers.list()[0]!.pending).toBe(0)
  })

  it('maps paths, skips kinds and unmapped paths, and says why', async () => {
    const s = fake('plex:a')
    ctx.mediaServers.register(
      s.provider,
      options(
        optionsOf({
          kinds: 'movie',
          pathMap: '/data/movies => /media/movies',
          debounceSeconds: 15,
        }),
      ),
    )
    change(['/data/movies/A/a.mkv', '/elsewhere/b.mkv'])
    change(['/data/tv/s.mkv'], [], 'series')
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(s.batches).toEqual([[{ path: '/media/movies/A/a.mkv', change: 'added' }]])
    expect(ctx.mediaServers.list()[0]!.lastSkipped).toContain('/elsewhere/b.mkv')
  })

  it('retries a failed request with the same paths and records the error', async () => {
    const s = fake('plex:a', 1)
    ctx.mediaServers.register(s.provider, options())
    change(['/m/A/a.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(ctx.mediaServers.list()[0]!.lastError).toBe('HTTP 503')
    clock += 60 * 60_000
    await ctx.jobs.tick()
    expect(s.batches).toHaveLength(1)
    expect(ctx.mediaServers.list()[0]!.lastError).toBeUndefined()
  })

  it('drops queued work for a removed server and leaves the others alone', async () => {
    const a = fake('plex:a')
    const b = fake('plex:b')
    const dispose = ctx.mediaServers.register(a.provider, options())
    ctx.mediaServers.register(b.provider, options())
    change(['/m/A/a.mkv'])
    ctx.mediaServers.flush()
    dispose()
    await ctx.jobs.tick()
    expect(a.batches).toEqual([])
    expect(b.batches).toHaveLength(1)
  })

  it('tests a connection without scanning, and a scan only when asked', async () => {
    const s = fake('plex:a')
    ctx.mediaServers.register(s.provider, options({ mappings: [{ from: '/data', to: '/media' }] }))
    expect(await ctx.mediaServers.test('plex:a')).toMatchObject({
      ok: true,
      message: expect.stringContaining('Movies (/media/movies)'),
    })
    expect(s.batches).toEqual([])
    expect(await ctx.mediaServers.testRefresh('plex:a', '/data/movies/Alien')).toMatchObject({
      ok: true,
      message: expect.stringContaining('/media/movies/Alien'),
    })
    expect(await ctx.mediaServers.testRefresh('plex:a', '/other')).toMatchObject({ ok: false })
    expect(s.batches).toHaveLength(1)
  })
})
