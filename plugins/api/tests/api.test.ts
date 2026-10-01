import Server from '@cordisjs/plugin-server'
import AuthService from '@magpiejs/auth'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { expect, it } from 'vitest'
import ApiService, { ApiError } from '../src'

it('serves JSON endpoints to API key holders', async () => {
  const ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(ApiService)
  const fiber = await ctx.plugin({
    inject: ['api'],
    apply(ctx: Context) {
      ctx.api.post('/echo/:id', ({ params, body }) => {
        if (!body?.name) throw new ApiError(422, 'name is required')
        return { id: params.id, name: body.name }
      })
    },
  })
  const { key } = ctx.auth.createApiKey('test')
  const call = (path: string, body?: unknown) =>
    fetch(`${ctx.server.baseUrl}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-api-key': key },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  expect(await (await call('/system/status')).json()).toMatchObject({ version: '0.0.0' })
  expect(await (await call('/echo/7', { name: 'x' })).json()).toEqual({ id: '7', name: 'x' })
  const bad = await call('/echo/7', {})
  expect([bad.status, await bad.json()]).toEqual([422, { error: 'name is required' }])

  // endpoints go away with the plugin that added them
  await fiber.dispose()
  expect((await call('/echo/7', { name: 'x' })).status).toBe(404)
  ctx.server._http.close()
})

it('checks what the caller may do: viewers read, managers change, settings need an administrator', async () => {
  const ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(ApiService)
  await ctx.plugin({
    inject: ['api'],
    apply(ctx: Context) {
      ctx.api.get('/things', () => ['a'])
      ctx.api.post('/things', () => ({ made: true }))
      ctx.api.as('settings.manage').put('/config', () => ({ saved: true }))
    },
  })
  const viewer = ctx.auth.createApiKey('viewer', { role: 'viewer' }).key
  const manager = ctx.auth.createApiKey('manager', { role: 'manager' }).key
  const admin = ctx.auth.createFirstAdmin('root')
  const session = `magpie_session=${ctx.auth.createSession(admin.id)}`
  const call = (method: string, path: string, headers: Record<string, string>) =>
    fetch(`${ctx.server.baseUrl}/api/v1${path}`, { method, headers }).then((r) => r.status)

  expect(await call('GET', '/things', { 'x-api-key': viewer })).toBe(200)
  expect(await call('POST', '/things', { 'x-api-key': viewer })).toBe(403)
  expect(await call('POST', '/things', { 'x-api-key': manager })).toBe(200)
  expect(await call('PUT', '/config', { 'x-api-key': manager })).toBe(403)
  expect(await call('PUT', '/config', { cookie: session })).toBe(200)
  expect(await call('GET', '/things', {})).toBe(401)
  ctx.server._http.close()
})
