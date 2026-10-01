import Server from '@cordisjs/plugin-server'
import AuthService from '@magpiejs/auth'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import * as AuthLocal from '../src'

let ctx: Context
let base: string
let local: Awaited<ReturnType<Context['plugin']>>
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  local = await ctx.plugin(AuthLocal, { minPasswordLength: 10 })
  base = ctx.server.baseUrl
  return () => void ctx.server._http.close()
})

const form = (path: string, fields: Record<string, string>) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  })
const setup = (fields: Record<string, string> = {}) =>
  form('/auth/local/setup', {
    username: 'root',
    password: 'long enough pass',
    confirm: 'long enough pass',
    ...fields,
  })

describe('password login', () => {
  it('offers to create the first account, then to log in', async () => {
    expect(await (await fetch(base + '/login')).text()).toContain('Create account')
    expect((await setup()).headers.get('set-cookie')).toContain('magpie_session=')
    expect(ctx.auth.users()).toEqual([
      expect.objectContaining({ username: 'root', role: 'admin', methods: ['local'] }),
    ])
    const page = await (await fetch(base + '/login')).text()
    expect(page).toContain('action="/auth/local/login"')
    expect(page).not.toContain('Create account')
  })

  it('refuses a second first-run account, a mismatch and a short password', async () => {
    const short = await setup({ password: 'short', confirm: 'short' })
    expect(short.headers.get('location')).toMatch(/at%20least%2010/)
    const mismatch = await setup({ confirm: 'something else' })
    expect(mismatch.headers.get('location')).toMatch(/differ/)
    expect(ctx.auth.users()).toEqual([])

    await setup()
    const again = await setup({ username: 'other' })
    expect(again.headers.get('location')).toMatch(/already%20exists/)
    expect(ctx.auth.users()).toHaveLength(1)
  })

  it('logs in only users who have a password', async () => {
    await setup()
    const nobody = ctx.auth.createUser('sam', 'viewer')
    expect(ctx.auth.users().find((u) => u.id === nobody.id)!.methods).toEqual([])
    for (const password of ['', 'password', 'long enough pass']) {
      const res = await form('/auth/local/login', { username: 'sam', password })
      expect(res.headers.get('location')).toMatch(/wrong%20username/)
    }
    await ctx.auth.providers.password()!.reset(nobody.id, 'now there is one')
    const ok = await form('/auth/local/login', { username: 'sam', password: 'now there is one' })
    expect(ok.headers.get('set-cookie')).toContain('magpie_session=')
  })

  it('changes a password only when the current one is right, and removes it with the user', async () => {
    await setup()
    const passwords = ctx.auth.providers.password()!
    const root = ctx.auth.userByName('root')!
    await expect(passwords.change(root.id, 'wrong', 'a new long one')).rejects.toThrow(/wrong/)
    await expect(passwords.change(root.id, 'long enough pass', 'short')).rejects.toThrow(/10/)
    await passwords.change(root.id, 'long enough pass', 'a new long one')
    expect(
      (await form('/auth/local/login', { username: 'root', password: 'a new long one' })).status,
    ).toBe(303)
    expect(
      (
        await form('/auth/local/login', { username: 'root', password: 'long enough pass' })
      ).headers.get('location'),
    ).toMatch(/wrong/)

    const sam = ctx.auth.createUser('sam', 'viewer')
    await passwords.reset(sam.id, 'sam has a pass')
    expect(passwords.has(sam.id)).toBe(true)
    ctx.auth.deleteUser(sam.id)
    expect(passwords.has(sam.id)).toBe(false)
  })

  it('goes away with the plugin', async () => {
    expect(ctx.auth.providers.list().map((p) => p.id)).toEqual(['local'])
    await local.dispose()
    expect(ctx.auth.providers.list()).toEqual([])
    expect(await (await fetch(base + '/login')).text()).toContain('No sign-in method is enabled')
  })
})
