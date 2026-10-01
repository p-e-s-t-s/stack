import Server from '@cordisjs/plugin-server'
import ApiService from '@magpiejs/api'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import AuthService from '../src'

let ctx: Context
let base: string
let admin: string
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(ApiService)
  base = ctx.server.baseUrl + '/api/v1'
  const root = await ctx.auth.setup('root', 'long enough')
  admin = `magpie_session=${ctx.auth.createSession(root.id)}`
  return () => void ctx.server._http.close()
})

async function request(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  contentType = 'application/json',
) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': contentType }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}

const cookieFor = async (username: string, role: 'viewer' | 'manager') => {
  const user = await ctx.auth.createUser(username, 'long enough', role)
  return { id: user.id, cookie: `magpie_session=${ctx.auth.createSession(user.id)}` }
}

describe('user management routes', () => {
  it('lets administrators list, add, change and remove users', async () => {
    const as = { cookie: admin }
    const made = await request('POST', '/users', as, {
      username: 'sam',
      password: 'long enough',
      role: 'viewer',
    })
    expect(made).toMatchObject({ status: 200, body: { username: 'sam', role: 'viewer' } })
    expect(JSON.stringify(made.body)).not.toMatch(/hash|scrypt/)
    const id = made.body.id

    expect((await request('GET', '/users', as)).body.map((u: any) => u.username)).toEqual([
      'root',
      'sam',
    ])
    expect(await request('PATCH', `/users/${id}`, as, { role: 'manager' })).toMatchObject({
      status: 204,
    })
    expect(ctx.auth.user(id)?.role).toBe('manager')
    expect(
      await request('PUT', `/users/${id}/password`, as, { password: 'another one' }),
    ).toMatchObject({
      status: 204,
    })
    expect(await request('DELETE', `/users/${id}`, as)).toMatchObject({ status: 204 })
    expect(ctx.auth.user(id)).toBeUndefined()
  })

  it('reports what the service refuses as 400', async () => {
    const as = { cookie: admin }
    const [root] = ctx.auth.users()
    const taken = await request('POST', '/users', as, {
      username: 'root',
      password: 'long enough',
      role: 'viewer',
    })
    expect(taken).toMatchObject({ status: 400, body: { error: expect.stringMatching(/taken/) } })
    expect(
      (await request('PATCH', `/users/${root!.id}`, as, { role: 'viewer' })).body.error,
    ).toMatch(/administrator/)
    expect((await request('DELETE', `/users/${root!.id}`, as)).body.error).toMatch(/own account/)
    expect((await request('PATCH', '/users/abc', as, {})).status).toBe(400)
  })

  it('keeps everyone but administrators out', async () => {
    const manager = await cookieFor('mia', 'manager')
    const viewer = await cookieFor('vic', 'viewer')
    const key = ctx.auth.createApiKey('k', { role: 'manager' }).key
    const callers: Record<string, string>[] = [
      { cookie: manager.cookie },
      { cookie: viewer.cookie },
      { 'x-api-key': key },
    ]
    for (const who of callers) {
      expect((await request('GET', '/users', who)).status).toBe(403)
      expect((await request('POST', '/users', who, { username: 'x' })).status).toBe(403)
      expect((await request('GET', '/api-keys', who)).status).toBe(403)
      expect((await request('POST', '/api-keys', who, { name: 'x' })).status).toBe(403)
    }
    expect((await request('GET', '/users', {})).status).toBe(401)
  })

  it('makes API keys for the administrator who asks, for viewers and managers only', async () => {
    const as = { cookie: admin }
    const made = await request('POST', '/api-keys', as, { name: 'Home Assistant', role: 'viewer' })
    expect(made.status).toBe(200)
    expect(made.body.key).toEqual(expect.any(String))
    expect(await request('GET', '/system/status', { 'x-api-key': made.body.key })).toMatchObject({
      status: 200,
    })
    // the new key cannot change anything
    expect(
      (await request('POST', '/api-keys', { 'x-api-key': made.body.key }, { name: 'x' })).status,
    ).toBe(403)

    expect((await request('POST', '/api-keys', as, { name: 'x', role: 'admin' })).status).toBe(400)
    const list = await request('GET', '/api-keys', as)
    expect(list.body).toEqual([expect.objectContaining({ name: 'Home Assistant', owner: 'root' })])
    expect(JSON.stringify(list.body)).not.toContain(made.body.key)
    expect(await request('DELETE', `/api-keys/${made.body.id}`, as)).toMatchObject({ status: 204 })
    expect((await request('GET', '/system/status', { 'x-api-key': made.body.key })).status).toBe(
      401,
    )
  })
})

describe('account routes', () => {
  it('shows you your own account and sessions', async () => {
    const viewer = await cookieFor('vic', 'viewer')
    const second = ctx.auth.createSession(viewer.id)
    const account = await request('GET', '/account', { cookie: viewer.cookie })
    expect(account.body).toMatchObject({ username: 'vic', role: 'viewer' })
    expect(account.body.permissions).toContain('library.read')
    expect(account.body.sessions).toHaveLength(2)
    expect(account.body.sessions.filter((s: any) => s.current)).toHaveLength(1)
    expect(second).toBeTruthy()
  })

  it('changes your password, ending your other sessions but not this one', async () => {
    const mia = await cookieFor('mia', 'manager')
    const other = `magpie_session=${ctx.auth.createSession(mia.id)}`
    const wrong = await request(
      'PUT',
      '/account/password',
      { cookie: mia.cookie },
      {
        current: 'nope nope',
        next: 'something new',
      },
    )
    expect(wrong).toMatchObject({ status: 400, body: { error: expect.stringMatching(/wrong/) } })
    const done = await request(
      'PUT',
      '/account/password',
      { cookie: mia.cookie },
      {
        current: 'long enough',
        next: 'something new',
      },
    )
    expect(done.status).toBe(204)
    expect((await request('GET', '/account', { cookie: mia.cookie })).status).toBe(200)
    expect((await request('GET', '/account', { cookie: other })).status).toBe(401)
  })

  it('ends one session, or all the others, but only your own', async () => {
    const vic = await cookieFor('vic', 'viewer')
    const sam = await cookieFor('sam', 'viewer')
    const extra = `magpie_session=${ctx.auth.createSession(vic.id)}`
    const mine = (await request('GET', '/account', { cookie: vic.cookie })).body.sessions
    const theirs = (await request('GET', '/account', { cookie: sam.cookie })).body.sessions[0].id
    // someone else's session id does nothing
    await request('DELETE', `/account/sessions/${theirs}`, { cookie: vic.cookie })
    expect((await request('GET', '/account', { cookie: sam.cookie })).status).toBe(200)

    const other = mine.find((s: any) => !s.current).id
    await request('DELETE', `/account/sessions/${other}`, { cookie: vic.cookie })
    expect((await request('GET', '/account', { cookie: extra })).status).toBe(401)

    const again = `magpie_session=${ctx.auth.createSession(vic.id)}`
    await request('DELETE', '/account/sessions', { cookie: vic.cookie })
    expect((await request('GET', '/account', { cookie: again })).status).toBe(401)
    expect((await request('GET', '/account', { cookie: vic.cookie })).status).toBe(200)
  })

  it('is for people who logged in, not API keys', async () => {
    const key = ctx.auth.createApiKey('k', { role: 'manager' }).key
    expect((await request('GET', '/account', { 'x-api-key': key })).status).toBe(403)
  })
})

describe('browser requests', () => {
  it('must send JSON when they send a body', async () => {
    const as = { cookie: admin }
    const form = await request(
      'POST',
      '/users',
      as,
      { username: 'x', password: 'long enough', role: 'viewer' },
      'text/plain',
    )
    expect(form.status).toBe(415)
    expect(ctx.auth.users()).toHaveLength(1)
  })
})
