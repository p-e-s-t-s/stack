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
