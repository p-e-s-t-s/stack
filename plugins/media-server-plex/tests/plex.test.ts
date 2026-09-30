import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import MediaServers from '@magpiejs/media-servers'
import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Plex from '../src'
import { plan } from '../src'

const SECTIONS = [
  { key: '1', title: 'Movies', Location: [{ path: '/media/movies' }] },
  { key: '2', title: 'TV', Location: [{ path: '/media/tv' }, { path: '/media/anime' }] },
]

let server: Server
let requests: { url: string; token: unknown }[]
let status: number
let ctx: Context

beforeEach(async () => {
  requests = []
  status = 200
  server = createServer((req, res) => {
    requests.push({ url: req.url!, token: req.headers['x-plex-token'] })
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ MediaContainer: { Directory: SECTIONS } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(MediaServers)
})

afterEach(() => new Promise((resolve) => server.close(resolve)))

const config = (extra = {}) =>
  Plex.Config({
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token: 'tok',
    ...extra,
  } as never)

const change = (added: string[]) =>
  ctx.emit('media/changed', {
    origin: 'download',
    item: { id: 1, kind: 'movie', title: 'T', year: null } as never,
    added,
    removed: [],
    replaced: false,
  })

describe('plex plan', () => {
  it('scans each changed folder once, in the library that contains it', () => {
    const { scans, unmatched } = plan(
      [
        { path: '/media/movies/Alien/a.mkv', change: 'added' },
        { path: '/media/movies/Alien/b.mkv', change: 'added' },
        { path: '/media/anime/Show/s1.mkv', change: 'added' },
        { path: '/media/moviesextra/x.mkv', change: 'added' },
      ],
      SECTIONS,
    )
    expect(scans.map((s) => [s.section.key, s.folder])).toEqual([
      ['1', '/media/movies/Alien'],
      ['2', '/media/anime/Show'],
    ])
    expect(unmatched).toEqual(['/media/moviesextra/x.mkv'])
  })
})

describe('plex server', () => {
  it('lists libraries without scanning when testing', async () => {
    await ctx.plugin(Plex, config())
    const result = await ctx.mediaServers.test(ctx.mediaServers.list()[0]!.id)
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('TV') })
    expect(requests.every((r) => !r.url.includes('/refresh'))).toBe(true)
    expect(requests.every((r) => r.token === 'tok')).toBe(true)
  })

  it('asks for a scan of the changed folder after an import', async () => {
    await ctx.plugin(Plex, config())
    change(['/media/movies/Alien (1979)/Alien.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(requests.map((r) => r.url)).toContain(
      `/library/sections/1/refresh?path=${encodeURIComponent('/media/movies/Alien (1979)')}`,
    )
  })

  it('only touches the libraries it is limited to', async () => {
    await ctx.plugin(Plex, config({ libraries: 'TV' }))
    change(['/media/movies/Alien/a.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(requests.some((r) => r.url.includes('/refresh'))).toBe(false)
    expect(ctx.mediaServers.list()[0]!.lastError).toContain('no selected Plex library')
  })

  it('reports a rejected token without the address', async () => {
    await ctx.plugin(Plex, config())
    status = 401
    const result = await ctx.mediaServers.test(ctx.mediaServers.list()[0]!.id)
    expect(result).toEqual({ ok: false, message: 'Plex refused the token' })
  })
})
