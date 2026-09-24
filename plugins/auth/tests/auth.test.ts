import Server from '@cordisjs/plugin-server'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import AuthService from '../src'

let ctx: Context
let base: string
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  ctx.server.get('/api/v1/ping', async (_req, res) => void res.json({ pong: true }))
  ctx.server.get('/', async (_req, res) => void res.text('console'))
  ctx.server.ws('/ws')
  base = ctx.server.baseUrl
  return () => void ctx.server._http.close()
})

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { headers, redirect: 'manual' })
const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form),
    redirect: 'manual',
  })
const cookieOf = (res: globalThis.Response) => res.headers.get('set-cookie')!.split(';')[0]!

async function setup() {
  const res = await post('/auth/setup', {
    username: 'admin',
    password: 'correct horse',
    confirm: 'correct horse',
    next: '/movies',
  })
  expect(res.headers.get('location')).toBe('/movies')
  return cookieOf(res)
}

describe('auth', () => {
  it('sends visitors to the login page, which creates the account on first start', async () => {
    const page = await get('/movies?x=1', { accept: 'text/html' })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/login?next=%2Fmovies%3Fx%3D1')
    expect((await get('/api/v1/ping')).status).toBe(401)
    expect(await (await get('/login')).text()).toContain('Create your account')

    const cookie = await setup()
    expect(await (await get('/', { cookie })).text()).toBe('console')
    // only one first-start setup
    const again = await post('/auth/setup', {
      username: 'x',
      password: '12345678',
      confirm: '12345678',
    })
    expect(again.headers.get('location')).toMatch(/^\/login\?error=/)
    expect(ctx.auth.users()).toHaveLength(1)
  })

  it('logs in and out, and refuses wrong passwords and outside redirects', async () => {
    await setup()
    const wrong = await post('/auth/login', { username: 'admin', password: 'nope' })
    expect(wrong.headers.get('location')).toMatch(/error=wrong/)

    const ok = await post('/auth/login', {
      username: 'admin',
      password: 'correct horse',
      next: '//evil.example',
    })
    expect(ok.headers.get('location')).toBe('/')
    const cookie = cookieOf(ok)
    expect((await get('/auth/status', { cookie })).status).toBe(200)

    await post('/auth/logout', {}, { cookie })
    expect((await get('/auth/status', { cookie })).status).toBe(401)
  })

  it('accepts API keys under /api only, and guards the WebSocket', async () => {
    const cookie = await setup()
    const { key, row } = ctx.auth.createApiKey('Prowlarr')
    expect((await get('/api/v1/ping', { 'x-api-key': key })).status).toBe(200)
    expect((await get(`/api/v1/ping?apikey=${key}`)).status).toBe(200)
    expect((await get('/', { 'x-api-key': key })).headers.get('location')).toMatch(/^\/login/)
    ctx.auth.revokeApiKey(row.id)
    expect((await get('/api/v1/ping', { 'x-api-key': key })).status).toBe(401)

    const open = (headers: Record<string, string>) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers })
        ws.on('open', () => (ws.close(), resolve(true)))
        ws.on('error', () => resolve(false))
      })
    expect(await open({})).toBe(false)
    expect(await open({ cookie, origin: 'http://evil.example' })).toBe(false)
    expect(await open({ cookie, origin: base })).toBe(true)
  })
})
