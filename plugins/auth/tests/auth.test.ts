import Server from '@cordisjs/plugin-server'
import DatabaseService from '@magpiejs/database'
import { DatabaseSync } from 'node:sqlite'
import { readMigrations } from '@magpiejs/database/runner'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import AuthService, { roleCan, ROLES } from '../src'

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

describe('roles and permissions', () => {
  it('gives each role a growing set of permissions and unknown roles none', () => {
    expect(roleCan('viewer', 'library.read')).toBe(true)
    expect(roleCan('viewer', 'library.write')).toBe(false)
    expect(roleCan('manager', 'library.write')).toBe(true)
    expect(roleCan('manager', 'settings.manage')).toBe(false)
    expect(roleCan('manager', 'users.manage')).toBe(false)
    expect(roleCan('admin', 'users.manage')).toBe(true)
    expect(roleCan('root', 'library.read')).toBe(false)
    // every role has what the one below it has
    for (const [i, role] of ROLES.entries()) {
      for (const below of ROLES.slice(i + 1)) {
        for (const permission of ['account.self', 'library.read'] as const)
          expect(roleCan(role, permission) || !roleCan(below, permission)).toBe(true)
      }
    }
  })

  it('makes the account that existed before roles an administrator', () => {
    const db = new DatabaseSync(':memory:')
    const [init, roles] = readMigrations(new URL('../migrations', import.meta.url))
    for (const statement of init!.statements) db.exec(statement)
    db.exec("INSERT INTO auth_users (username, password_hash, created_at) VALUES ('old', 'x', 1)")
    db.exec(
      "INSERT INTO auth_api_keys (name, key_hash, prefix, created_at) VALUES ('k', 'h', 'p', 1)",
    )
    for (const statement of roles!.statements) db.exec(statement)
    expect(db.prepare('SELECT role, disabled FROM auth_users').get()).toMatchObject({
      role: 'admin',
      disabled: 0,
    })
    expect(db.prepare('SELECT role, user_id FROM auth_api_keys').get()).toMatchObject({
      role: 'manager',
      user_id: null,
    })
  })
})

describe('users', () => {
  it('creates users with roles, and refuses duplicates and weak passwords', async () => {
    await setup()
    const [admin] = ctx.auth.users()
    expect(admin).toMatchObject({ username: 'admin', role: 'admin', disabled: false })
    const viewer = await ctx.auth.createUser('sam', 'long enough', 'viewer')
    expect(viewer.role).toBe('viewer')
    await expect(ctx.auth.createUser('sam', 'long enough', 'viewer')).rejects.toThrow(/taken/)
    await expect(ctx.auth.createUser('kim', 'short', 'viewer')).rejects.toThrow(/8 characters/)
    await expect(ctx.auth.createUser('kim', 'long enough', 'root' as 'admin')).rejects.toThrow(
      /role/,
    )
    expect(ctx.auth.users().map((u) => u.username)).toEqual(['admin', 'sam'])
  })

  it('keeps one active administrator', async () => {
    await setup()
    const [admin] = ctx.auth.users()
    expect(() => ctx.auth.updateUser(admin!.id, { role: 'manager' })).toThrow(/administrator/)
    expect(() => ctx.auth.updateUser(admin!.id, { disabled: true })).toThrow(/administrator/)
    expect(() => ctx.auth.deleteUser(admin!.id)).toThrow(/administrator/)
    const second = await ctx.auth.createUser('ann', 'long enough', 'admin')
    ctx.auth.updateUser(admin!.id, { role: 'manager' })
    // now ann is the only one
    expect(() => ctx.auth.deleteUser(second.id)).toThrow(/administrator/)
    expect(() => ctx.auth.deleteUser(second.id, second.id)).toThrow(/own account/)
  })

  it('ends sessions when a user is switched off or gets a new password', async () => {
    await setup()
    const sam = await ctx.auth.createUser('sam', 'long enough', 'manager')
    const login = async (password = 'long enough') =>
      cookieOf(await post('/auth/login', { username: 'sam', password }))
    const first = await login()
    const second = await login()
    expect((await get('/auth/status', { cookie: first })).status).toBe(200)

    ctx.auth.updateUser(sam.id, { disabled: true })
    expect((await get('/auth/status', { cookie: first })).status).toBe(401)
    const refused = await post('/auth/login', { username: 'sam', password: 'long enough' })
    expect(refused.headers.get('location')).toMatch(/switched%20off/)

    ctx.auth.updateUser(sam.id, { disabled: false })
    const third = await login()
    expect((await get('/auth/status', { cookie: third })).status).toBe(200)
    expect((await get('/auth/status', { cookie: second })).status).toBe(401)

    await ctx.auth.resetPassword(sam.id, 'a new password')
    expect((await get('/auth/status', { cookie: third })).status).toBe(401)
    expect((await login('a new password').then(Boolean)) && true).toBe(true)
  })

  it("lists and revokes a user's own sessions only", async () => {
    const cookie = await setup()
    const sam = await ctx.auth.createUser('sam', 'long enough', 'viewer')
    const samCookie = cookieOf(
      await post('/auth/login', { username: 'sam', password: 'long enough' }),
    )
    const [admin] = ctx.auth.users()
    const mine = ctx.auth.sessions(admin!.id)
    expect(mine).toHaveLength(1)
    // someone else's session id does nothing
    ctx.auth.revokeSession(sam.id, mine[0]!.id)
    expect((await get('/auth/status', { cookie })).status).toBe(200)
    ctx.auth.revokeSession(admin!.id, mine[0]!.id)
    expect((await get('/auth/status', { cookie })).status).toBe(401)
    expect((await get('/auth/status', { cookie: samCookie })).status).toBe(200)
  })

  it('limits failed logins per username as well as per address', async () => {
    await setup()
    for (let i = 0; i < 10; i++) await post('/auth/login', { username: 'admin', password: 'nope' })
    const blocked = await post('/auth/login', { username: 'admin', password: 'correct horse' })
    expect(blocked.headers.get('location')).toMatch(/too%20many/)
  })
})

describe('API keys', () => {
  it('never rank above admin-free roles or the person who made them', async () => {
    await setup()
    const ann = await ctx.auth.createUser('ann', 'long enough', 'manager')
    expect(() => ctx.auth.createApiKey('x', { role: 'admin' as 'manager' })).toThrow(/viewer or/)
    const { key } = ctx.auth.createApiKey('Home Assistant', { role: 'manager', userId: ann.id })
    expect(ctx.auth.checkApiKey(key)?.role).toBe('manager')
    ctx.auth.updateUser(ann.id, { role: 'viewer' })
    expect(ctx.auth.checkApiKey(key)?.role).toBe('viewer')
    ctx.auth.updateUser(ann.id, { disabled: true })
    expect(ctx.auth.checkApiKey(key)).toBeUndefined()
    expect(ctx.auth.apiKeys()[0]).toMatchObject({ owner: 'ann', role: 'manager' })
    ctx.auth.deleteUser(ann.id)
    expect(ctx.auth.apiKeys()).toEqual([])
  })
})
