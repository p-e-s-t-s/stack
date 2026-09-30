import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import MediaServers from '@magpiejs/media-servers'
import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Server_ from '../src'
import { body } from '../src'

const FOLDERS = [
  { Name: 'Movies', Locations: ['/media/movies'] },
  { Name: 'TV', Locations: ['/media/tv'] },
]

let server: Server
let requests: { method?: string; url?: string; auth: string; body: string }[]
let status: number
let ctx: Context

beforeEach(async () => {
  requests = []
  status = 200
  server = createServer((req, res) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        auth: String(req.headers['authorization']),
        body: data,
      })
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(req.method === 'GET' ? JSON.stringify(FOLDERS) : '')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(MediaServers)
})

afterEach(() => new Promise((resolve) => server.close(resolve)))

const config = (extra = {}) =>
  Server_.Config({
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    apiKey: 'key',
    ...extra,
  } as never)

const change = (added: string[], removed: string[] = []) =>
  ctx.emit('media/changed', {
    origin: 'download',
    item: { id: 1, kind: 'movie', title: 'T', year: null } as never,
    added,
    removed,
    replaced: removed.length > 0,
  })

const updates = () => requests.filter((r) => r.method === 'POST')

describe('jellyfin request', () => {
  it('reports added files as created and removed ones as deleted', () => {
    expect(
      body([
        { path: '/m/a.mkv', change: 'added' },
        { path: '/m/old.mkv', change: 'removed' },
      ]),
    ).toEqual({
      Updates: [
        { Path: '/m/a.mkv', UpdateType: 'Created' },
        { Path: '/m/old.mkv', UpdateType: 'Deleted' },
      ],
    })
  })
})

describe('jellyfin server', () => {
  it('lists libraries without sending an update when testing', async () => {
    await ctx.plugin(Server_, config())
    const result = await ctx.mediaServers.test(ctx.mediaServers.list()[0]!.id)
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('Movies') })
    expect(updates()).toEqual([])
    expect(requests.every((r) => r.auth.includes('key'))).toBe(true)
  })

  it('posts the changed files after an import', async () => {
    await ctx.plugin(Server_, config())
    change(['/media/movies/Alien/a.mkv'], ['/media/movies/Alien/old.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(updates()).toHaveLength(1)
    expect(updates()[0]!.url).toBe('/Library/Media/Updated')
    expect(JSON.parse(updates()[0]!.body).Updates).toHaveLength(2)
  })

  it('leaves libraries it is not limited to alone', async () => {
    await ctx.plugin(Server_, config({ libraries: 'TV' }))
    change(['/media/movies/Alien/a.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(updates()).toEqual([])
    change(['/media/tv/Show/s.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(updates()).toHaveLength(1)
  })

  it('keeps going after an outage and says what happened', async () => {
    await ctx.plugin(Server_, config())
    status = 503
    change(['/media/movies/Alien/a.mkv'])
    ctx.mediaServers.flush()
    await ctx.jobs.tick()
    expect(ctx.mediaServers.list()[0]!.lastError).toContain('503')
  })

  it('reports a rejected key', async () => {
    await ctx.plugin(Server_, config())
    status = 401
    expect(await ctx.mediaServers.test(ctx.mediaServers.list()[0]!.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining('refused the API key'),
    })
  })
})
