import Server from '@cordisjs/plugin-server'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import AuthService, { type IdentityProvider } from '../src'

let ctx: Context
let base: string
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  base = ctx.server.baseUrl
  return () => void ctx.server._http.close()
})

const provider = (extra: Partial<IdentityProvider> = {}): IdentityProvider => ({
  id: 'test',
  label: 'Test',
  ...extra,
})

describe('identity providers', () => {
  it('are added and removed at run time, and ids are not shared', async () => {
    let changes = 0
    ctx.auth.providers.onChange(() => changes++)
    const remove = ctx.auth.providers.register(provider())
    expect(ctx.auth.providers.list().map((p) => p.id)).toEqual(['test'])
    expect(() => ctx.auth.providers.register(provider())).toThrow(/already loaded/)
    expect(() => ctx.auth.providers.register(provider({ id: 'No Good' }))).toThrow(/invalid/)
    remove()
    expect(ctx.auth.providers.list()).toEqual([])
    expect(changes).toBe(2)
  })

  it('make the login page from what each provider offers', async () => {
    const page = async () => (await fetch(base + '/login?next=%2Fmovies&error=Nope')).text()
    expect(await page()).toContain('No sign-in method is enabled')

    ctx.auth.providers.register(
      provider({
        login: (view) => `<a href="/auth/test/go?next=${view.next}">Sign in with Test</a>`,
      }),
    )
    ctx.auth.providers.register(provider({ id: 'other', login: () => '<p>Other way in</p>' }))
    const html = await page()
    expect(html).toContain('Sign in with Test')
    expect(html).toContain('Other way in')
    expect(html).toContain('Nope')
    expect(html).toContain('Log in')

    // while there is no user, a provider that can create the first one takes the page
    ctx.auth.providers.register(
      provider({
        id: 'first',
        setup: (view) => (view.setup ? '<p>Make the first account</p>' : undefined),
      }),
    )
    const first = await page()
    expect(first).toContain('Create your account')
    expect(first).toContain('Make the first account')
    expect(first).not.toContain('Other way in')
    ctx.auth.createFirstAdmin('root')
    expect(await page()).toContain('Other way in')
  })
})

describe('matching people from a provider to users', () => {
  const login = (subject: string, extra = {}) => ({
    provider: 'test',
    subject,
    username: subject,
    ...extra,
  })

  it('refuses people it may not make users of, and makes the rest with the role given', () => {
    expect(ctx.auth.resolveExternal(login('amy'))).toBeUndefined()
    const amy = ctx.auth.resolveExternal(login('amy', { create: { role: 'viewer' } }))!
    expect(amy).toMatchObject({ username: 'amy', role: 'viewer' })
    // the same person is found again, not made twice
    expect(ctx.auth.resolveExternal(login('amy'))?.id).toBe(amy.id)
    expect(ctx.auth.users()).toHaveLength(1)
    expect(ctx.auth.users()[0]!.methods).toEqual(['test'])
  })

  it('never hands an existing user to someone just because the names match', () => {
    const root = ctx.auth.createFirstAdmin('root')
    const stranger = ctx.auth.resolveExternal(login('root', { create: { role: 'viewer' } }))!
    // made as root-2 instead, with the viewer role
    expect(stranger).toMatchObject({ username: 'root-2', role: 'viewer' })
    expect(stranger.id).not.toBe(root.id)
  })

  it('can match by name when the provider says its names are trusted', () => {
    const root = ctx.auth.createFirstAdmin('root')
    const found = ctx.auth.resolveExternal(login('root', { matchUsername: true }))!
    expect(found.id).toBe(root.id)
    expect(ctx.auth.resolveExternal(login('root'))?.id).toBe(root.id)
    // a different identity at the same provider cannot also take that user
    expect(
      ctx.auth.resolveExternal(login('root', { matchUsername: true, subject: 'other' })),
    ).toBeUndefined()
  })

  it('lets the provider decide roles on each login, without removing the last administrator', () => {
    const amy = ctx.auth.resolveExternal(login('amy', { create: { role: 'manager' } }))!
    expect(ctx.auth.resolveExternal(login('amy', { role: 'viewer' }))?.role).toBe('viewer')
    expect(ctx.auth.user(amy.id)?.role).toBe('viewer')

    ctx.auth.resolveExternal(login('boss', { create: { role: 'admin' } }))
    // the only administrator stays one, even if the provider now says otherwise
    expect(ctx.auth.resolveExternal(login('boss', { role: 'viewer' }))?.role).toBe('admin')
  })

  it('does not sign in switched-off users', async () => {
    ctx.auth.providers.register(
      provider({
        authenticate: (req) =>
          req.headers.get('x-user')
            ? { provider: 'test', subject: 'amy', username: 'amy', create: { role: 'viewer' } }
            : undefined,
      }),
    )
    const amy = ctx.auth.resolveExternal(login('amy', { create: { role: 'viewer' } }))!
    ctx.auth.createUser('root', 'admin')
    ctx.auth.updateUser(amy.id, { disabled: true })
    const res = await fetch(base + '/api/v1/x', {
      headers: { 'x-user': 'amy' },
      redirect: 'manual',
    })
    expect(res.status).toBe(401)
  })
})

describe('signing in without a form', () => {
  it('starts a session for a request a provider vouches for, so the next one needs no proof', async () => {
    ctx.auth.providers.register(
      provider({
        authenticate: (req) => {
          const name = req.headers.get('x-user')
          return name
            ? { provider: 'test', subject: name, username: name, create: { role: 'viewer' } }
            : undefined
        },
      }),
    )
    ctx.server.get('/', async (_req, res) => void res.text('console'))
    expect(
      (await fetch(base + '/', { redirect: 'manual', headers: { accept: 'text/html' } })).status,
    ).toBe(303)

    const first = await fetch(base + '/', { headers: { 'x-user': 'amy' } })
    expect(await first.text()).toBe('console')
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!
    // the cookie alone is enough afterwards
    expect(await (await fetch(base + '/', { headers: { cookie } })).text()).toBe('console')
    expect(ctx.auth.users()).toEqual([expect.objectContaining({ username: 'amy', role: 'viewer' })])
    // and so is the login page, which sends a signed-in browser on
    const login = await fetch(base + '/login?next=%2Fmovies', {
      headers: { 'x-user': 'amy' },
      redirect: 'manual',
    })
    expect(login.headers.get('location')).toBe('/movies')
  })
})
