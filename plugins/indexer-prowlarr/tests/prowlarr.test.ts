import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import Server_ from '@cordisjs/plugin-server'
import AuthService from '@magpiejs/auth'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import { Context } from 'cordis'
import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest'
import * as prowlarr from '../src'

// a stand-in for Prowlarr: its v1 indexer list, and a Torznab proxy per indexer
let fake: Server
let url: string
let list: object[]
const seen: { path: string; key?: string }[] = []
beforeAll(async () => {
  fake = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    seen.push({
      path: u.pathname,
      key: String(req.headers['x-api-key'] ?? u.searchParams.get('apikey')),
    })
    if (u.pathname === '/api/v1/indexer') {
      if (req.headers['x-api-key'] !== 'secret') {
        res.statusCode = 401
        return res.end('{}')
      }
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(list))
    }
    res.setHeader('content-type', 'application/xml')
    res.end(
      u.searchParams.get('t') === 'caps'
        ? '<caps><searching><search available="yes" supportedParams="q"/></searching><categories/></caps>'
        : '<rss><channel></channel></rss>',
    )
  })
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
})
afterAll(() => fake.close())

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.server?._http.close()
})

async function boot(config: Partial<prowlarr.Config>) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(Server_, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(IndexersService)
  const fiber = await ctx.plugin(prowlarr, prowlarr.Config(config) as never)
  return { ctx, fiber }
}

const names = (ctx: Context) =>
  ctx.indexers
    .health()
    .map((i) => `${i.id} ${i.name} ${i.protocol} p${i.priority}`)
    .sort()

it('pulls the indexers from Prowlarr (v1) and follows its changes', async () => {
  list = [
    { id: 1, name: 'Tracker', enable: true, protocol: 'torrent', priority: 10 },
    { id: 2, name: 'Usenet', enable: true, protocol: 'usenet', priority: 25 },
    { id: 3, name: 'Off', enable: false, protocol: 'torrent', priority: 25 },
  ]
  const { ctx, fiber } = await boot({ url: `${url}/`, apiKey: 'secret', acceptPush: false })
  await vi.waitFor(() =>
    expect(names(ctx)).toEqual(['prowlarr:1 Tracker torrent p10', 'prowlarr:2 Usenet usenet p25']),
  )
  // an indexer is searched through Prowlarr's own proxy, with Prowlarr's key
  const provider = ctx.indexers.get('prowlarr:1')!.provider
  expect(await provider.test()).toMatchObject({ ok: true })
  expect(seen.at(-1)).toEqual({ path: '/1/api', key: 'secret' })

  // gone in Prowlarr, gone here; a failed look keeps what there is
  list = [{ id: 2, name: 'Usenet renamed', enable: true, protocol: 'usenet', priority: 25 }]
  await fiber.dispose()
  expect(names(ctx)).toEqual([])
})

it('registers nothing, and keeps running, when Prowlarr refuses the key', async () => {
  list = [{ id: 1, name: 'Tracker', enable: true, protocol: 'torrent', priority: 25 }]
  const { ctx } = await boot({ url, apiKey: 'wrong', acceptPush: false })
  await new Promise((r) => setTimeout(r, 100))
  expect(names(ctx)).toEqual([])
})

function api(ctx: Context, key: string) {
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${ctx.server.baseUrl}/api/v3${path}`, {
      method,
      headers: { 'x-api-key': key },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : undefined }
  }
}

/** What Prowlarr sends for an indexer: the schema's Torznab template, filled in. */
function pushed(call: ReturnType<typeof api>, overrides: Record<string, unknown> = {}) {
  return call('GET', '/indexer/schema').then(({ body }) => {
    const template = body.find((s: { implementation: string }) => s.implementation === 'Torznab')
    const values: Record<string, unknown> = {
      baseUrl: `${url}/7/`,
      apiPath: '/api',
      apiKey: 'prowlarr-key',
      ...overrides,
    }
    return {
      ...template,
      name: 'Prowlarr (Tracker)',
      priority: 12,
      fields: template.fields.map((f: { name: string }) =>
        f.name in values ? { ...f, value: values[f.name] } : f,
      ),
    }
  })
}

it('answers Prowlarr as a Radarr/Sonarr (v3): status, schema, test, add, change, remove', async () => {
  list = []
  const { ctx } = await boot({ acceptPush: true })
  const { key } = ctx.auth.createApiKey('prowlarr', { role: 'manager' })
  const call = api(ctx, key)

  expect((await call('GET', '/system/status')).body).toMatchObject({
    appName: 'Magpie',
    version: '5.0.0.0',
  })
  const schema = (await call('GET', '/indexer/schema')).body
  expect(schema.map((s: { implementation: string }) => s.implementation)).toEqual([
    'Torznab',
    'Newznab',
  ])
  expect((await call('GET', '/indexer')).body).toEqual([])

  const resource = await pushed(call)
  expect((await call('POST', '/indexer/test', resource)).status).toBe(200)
  const broken = await pushed(call, { baseUrl: 'ftp://nope' })
  expect((await call('POST', '/indexer/test', broken)).body).toMatchObject([
    { propertyName: 'BaseUrl' },
  ])
  const unreachable = await pushed(call, { baseUrl: 'http://127.0.0.1:1/' })
  const failed = await call('POST', '/indexer/test', unreachable)
  expect([failed.status, failed.body[0].propertyName]).toEqual([400, 'BaseUrl'])

  const added = await call('POST', '/indexer?forceSave=true', resource)
  expect(added.status).toBe(200)
  const id = added.body.id
  expect(id).toBeGreaterThan(0)
  await vi.waitFor(() =>
    expect(names(ctx)).toEqual([`prowlarr:push:${id} Prowlarr (Tracker) torrent p12`]),
  )
  // what Prowlarr reads back is what it sent, so it sees nothing to change
  expect((await call('GET', `/indexer/${id}`)).body).toEqual({ ...resource, id })
  expect((await call('GET', '/indexer')).body).toEqual([{ ...resource, id }])
  expect((await ctx.indexers.get(`prowlarr:push:${id}`)!.provider.test()).ok).toBe(true)
  expect(seen.at(-1)).toEqual({ path: '/7/api', key: 'prowlarr-key' })

  // the same feed pushed again, as Sonarr does after Radarr, is one indexer
  const again = (await call('POST', '/indexer', resource)).body
  await new Promise((r) => setTimeout(r, 50))
  expect(names(ctx)).toHaveLength(1)

  const renamed = { ...resource, id, name: 'Renamed', priority: 3 }
  expect((await call('PUT', `/indexer/${id}`, renamed)).status).toBe(200)
  await vi.waitFor(() => expect(names(ctx)).toEqual([`prowlarr:push:${id} Renamed torrent p3`]))

  expect((await call('DELETE', `/indexer/${again.id}`)).status).toBe(200)
  expect((await call('DELETE', `/indexer/${id}`)).status).toBe(200)
  await vi.waitFor(() => expect(names(ctx)).toEqual([]))
  expect((await call('GET', `/indexer/${id}`)).status).toBe(404)
  expect((await call('DELETE', `/indexer/${id}`)).status).toBe(404)

  // a usenet indexer is told apart by its implementation
  const usenet = {
    ...(await pushed(call)),
    implementation: 'Newznab',
    protocol: 'usenet',
  }
  const made = (await call('POST', '/indexer', usenet)).body
  await vi.waitFor(() => expect(names(ctx)[0]).toContain('usenet'))
  await call('DELETE', `/indexer/${made.id}`)

  // tags are made once
  const tag = (await call('POST', '/tag', { label: 'prowlarr' })).body
  expect((await call('POST', '/tag', { label: 'prowlarr' })).body).toEqual(tag)
  expect((await call('GET', '/tag')).body).toEqual([tag])
})

it('only lets a manager key push', async () => {
  const { ctx } = await boot({ acceptPush: true })
  const viewer = api(ctx, ctx.auth.createApiKey('viewer', { role: 'viewer' }).key)
  expect((await viewer('GET', '/indexer')).status).toBe(403)
  expect((await api(ctx, 'wrong')('GET', '/indexer')).status).toBe(401)
})

it('merges a pulled and a pushed indexer for the same feed into one', async () => {
  list = [{ id: 7, name: 'Tracker', enable: true, protocol: 'torrent', priority: 25 }]
  const { ctx } = await boot({ url, apiKey: 'secret', acceptPush: true })
  await vi.waitFor(() => expect(names(ctx)).toEqual(['prowlarr:7 Tracker torrent p25']))
  const call = api(ctx, ctx.auth.createApiKey('prowlarr', { role: 'manager' }).key)
  await call('POST', '/indexer', await pushed(call, { apiKey: 'secret' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(names(ctx)).toEqual(['prowlarr:7 Tracker torrent p25'])
})
