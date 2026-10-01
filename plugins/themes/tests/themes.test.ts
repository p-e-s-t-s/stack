import Server from '@cordisjs/plugin-server'
import AuthService from '@magpiejs/auth'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import ThemesService from '../src'

let ctx: Context
let base: string
let cookie: string

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(ThemesService)
  base = ctx.server.baseUrl
  const admin = ctx.auth.createFirstAdmin('admin')
  cookie = `magpie_session=${ctx.auth.createSession(admin.id)}`
  return () => void ctx.server._http.close()
})

const get = (path: string) => fetch(base + path, { headers: { cookie } })
const put = (path: string, body: unknown) =>
  fetch(base + path, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

interface Body {
  default?: string
  mine?: string | null
  chain?: string[]
  error?: string
  themes?: { id: string }[]
}
const json = async (res: globalThis.Response) => (await res.json()) as Body

const def = (id: string, extra: object = {}) => ({ id, name: id, apiVersion: 1, ...extra })

describe('registry', () => {
  it('lists the built-in default first, then registered themes, and forgets them on dispose', () => {
    const dispose = ctx.theme.register(def('compact'))
    expect(ctx.theme.list().map((t) => [t.id, t.available])).toEqual([
      ['default', true],
      ['compact', true],
    ])
    dispose()
    expect(ctx.theme.list().map((t) => t.id)).toEqual(['default'])
  })

  it('drops a theme when the plugin that registered it is disposed', async () => {
    const fiber = await ctx.plugin({
      inject: ['theme'],
      apply: (ctx: Context) => void ctx.theme.register(def('tv')),
    })
    expect(ctx.theme.list().map((t) => t.id)).toContain('tv')
    await fiber.dispose()
    expect(ctx.theme.list().map((t) => t.id)).not.toContain('tv')
  })

  it('refuses bad ids, duplicates, newer contracts and loops', () => {
    expect(() => ctx.theme.register(def('default'))).toThrow(/built-in/)
    expect(() => ctx.theme.register(def('Bad Id'))).toThrow(/lowercase/)
    ctx.theme.register(def('a', { extends: 'b' }))
    expect(() => ctx.theme.register(def('a'))).toThrow(/already/)
    expect(() => ctx.theme.register(def('future', { apiVersion: 99 }))).toThrow(/API/)
    expect(() => ctx.theme.register(def('b', { extends: 'a' }))).toThrow(/itself/)
  })

  it('marks a theme unavailable while its parent is not installed', () => {
    ctx.theme.register(def('tv', { extends: 'compact' }))
    expect(ctx.theme.list().find((t) => t.id === 'tv')?.available).toBe(false)
    ctx.theme.register(def('compact'))
    expect(ctx.theme.list().find((t) => t.id === 'tv')?.available).toBe(true)
  })
})

describe('choices', () => {
  it('follows the instance default until a user chooses', () => {
    ctx.theme.register(def('compact'))
    ctx.theme.register(def('tv', { extends: 'compact' }))
    expect(ctx.theme.resolve(1)).toEqual(['default'])
    ctx.theme.setDefault('compact')
    expect(ctx.theme.resolve(1)).toEqual(['compact', 'default'])
    ctx.theme.setPreference(1, 'tv')
    expect(ctx.theme.resolve(1)).toEqual(['tv', 'compact', 'default'])
    expect(ctx.theme.resolve(2)).toEqual(['compact', 'default'])
    ctx.theme.setPreference(1, null)
    expect(ctx.theme.resolve(1)).toEqual(['compact', 'default'])
  })

  it('falls back when the chosen theme is uninstalled, and keeps the choice for when it returns', () => {
    const dispose = ctx.theme.register(def('tv'))
    ctx.theme.setPreference(1, 'tv')
    dispose()
    expect(ctx.theme.resolve(1)).toEqual(['default'])
    expect(ctx.theme.preference(1)).toBe('tv')
    ctx.theme.register(def('tv'))
    expect(ctx.theme.resolve(1)).toEqual(['tv', 'default'])
  })

  it('rejects choosing a theme that is not installed or lost a parent', () => {
    ctx.theme.register(def('tv', { extends: 'compact' }))
    expect(() => ctx.theme.setPreference(1, 'nope')).toThrow(/no theme/)
    expect(() => ctx.theme.setPreference(1, 'tv')).toThrow(/parent/)
    expect(() => ctx.theme.setDefault('nope')).toThrow(/no theme/)
  })

  it('announces changes', () => {
    ctx.theme.register(def('compact'))
    let changes = 0
    ctx.on('theme/changed', () => void changes++)
    ctx.theme.setDefault('compact')
    ctx.theme.setPreference(1, 'compact')
    ctx.theme.setPreference(1, null)
    expect(changes).toBe(3)
  })
})

describe('HTTP', () => {
  it('needs a login', async () => {
    const res = await fetch(base + '/themes', { headers: { accept: 'application/json' } })
    expect(res.status).toBe(401)
  })

  it('tells the console its chain', async () => {
    ctx.theme.register(def('compact'))
    const body = await json(await get('/themes'))
    expect(body).toMatchObject({ default: 'default', mine: null, chain: ['default'] })
    expect(body.themes?.map((t) => t.id)).toEqual(['default', 'compact'])
  })

  it('saves a user choice and the instance default', async () => {
    ctx.theme.register(def('compact'))
    const mine = await put('/themes/me', { id: 'compact' })
    expect(mine.status).toBe(200)
    expect(await json(mine)).toEqual({ ok: true, chain: ['compact', 'default'] })
    expect((await json(await get('/themes'))).mine).toBe('compact')

    expect((await put('/themes/me', { id: null })).status).toBe(200)
    const all = await put('/themes/default', { id: 'compact' })
    expect((await json(all)).chain).toEqual(['compact', 'default'])
  })

  it('lets anyone choose their own theme but only an administrator the default', async () => {
    ctx.theme.register(def('compact'))
    const viewer = ctx.auth.createUser('vic', 'viewer')
    const as = {
      cookie: `magpie_session=${ctx.auth.createSession(viewer.id)}`,
      'content-type': 'application/json',
    }
    const call = (path: string) =>
      fetch(base + path, { method: 'PUT', headers: as, body: JSON.stringify({ id: 'compact' }) })
    expect((await call('/themes/me')).status).toBe(200)
    const refused = await call('/themes/default')
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toMatch(/administrator/)
    expect((await json(await get('/themes'))).default).toBe('default')
  })

  it('answers bad requests with a message', async () => {
    const missing = await put('/themes/me', { id: 'nope' })
    expect(missing.status).toBe(400)
    expect((await json(missing)).error).toMatch(/no theme/)
    expect((await put('/themes/me', { id: 3 })).status).toBe(400)
    const notJson = await fetch(base + '/themes/me', {
      method: 'PUT',
      headers: { cookie },
      body: 'x',
    })
    expect(notJson.status).toBe(400)
  })
})
