import { createHash } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Server from '@cordisjs/plugin-server'
import AuthService from '@magpiejs/auth'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as AuthOidc from '../src'

/** A small OpenID Connect provider: it remembers each authorization and answers token requests. */
class FakeProvider {
  server: HttpServer
  issuer = ''
  /** What the next ID token says; tests change it. */
  claims: Record<string, unknown> = { sub: 'amy-1', preferred_username: 'amy', groups: ['family'] }
  userinfo: Record<string, unknown> | undefined
  overrides: Record<string, unknown> = {}
  authorizations = new Map<string, { nonce: string; challenge: string; redirectUri: string }>()
  tokenRequests: { auth?: string; body: URLSearchParams }[] = []

  constructor() {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url!, this.issuer)
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
          userinfo_endpoint: `${this.issuer}/userinfo`,
          ...this.overrides,
        })
      }
      if (url.pathname === '/token') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = new URLSearchParams(raw)
        this.tokenRequests.push({ auth: req.headers.authorization, body })
        const authorization = this.authorizations.get(body.get('code') ?? '')
        const verifier = body.get('code_verifier') ?? ''
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        if (!authorization || authorization.challenge !== challenge)
          return json({ error: 'invalid_grant' }, 400)
        this.authorizations.delete(body.get('code')!)
        const claims = {
          iss: this.issuer,
          aud: 'magpie',
          exp: Math.floor(Date.now() / 1000) + 300,
          nonce: authorization.nonce,
          ...this.claims,
        }
        const jwt = ['{"alg":"none"}', JSON.stringify(claims), ''].map((part) =>
          Buffer.from(part).toString('base64url'),
        )
        return json({ id_token: jwt.join('.'), access_token: 'access-1' })
      }
      if (url.pathname === '/userinfo') {
        return req.headers.authorization === 'Bearer access-1' && this.userinfo
          ? json(this.userinfo)
          : json({ error: 'nope' }, 401)
      }
      res.writeHead(404).end()
    })
  }

  async listen() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  /** What the browser does at the provider: log in and come back with a code. */
  authorize(location: string) {
    const params = new URL(location).searchParams
    const code = `code-${this.authorizations.size + 1}`
    this.authorizations.set(code, {
      nonce: params.get('nonce')!,
      challenge: params.get('code_challenge')!,
      redirectUri: params.get('redirect_uri')!,
    })
    return { code, state: params.get('state')!, redirectUri: params.get('redirect_uri')! }
  }
}

let ctx: Context
let idp: FakeProvider
let base: string

async function start(config: Partial<AuthOidc.Config> = {}) {
  idp = new FakeProvider()
  await idp.listen()
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(AuthOidc, {
    label: 'Authelia',
    issuer: idp.issuer,
    clientId: 'magpie',
    clientSecret: 'shh',
    scopes: 'openid profile email groups',
    usernameClaim: 'preferred_username',
    groupsClaim: 'groups',
    adminGroups: ['admins'],
    managerGroups: ['family'],
    defaultRole: 'none',
    redirectUrl: '',
    syncRoles: true,
    matchUsername: false,
    ...config,
  })
  base = ctx.server.baseUrl
}
afterEach(() => {
  ctx?.server._http.close()
  idp?.server.close()
})

/** Runs the whole login as a browser would, and returns what the callback answered. */
async function login(options: { state?: string; cookie?: boolean; next?: string } = {}) {
  const started = await fetch(
    `${base}/auth/oidc/start?next=${encodeURIComponent(options.next ?? '/movies')}`,
    {
      redirect: 'manual',
    },
  )
  const location = started.headers.get('location')!
  const cookie = started.headers.get('set-cookie')?.split(';')[0]
  const { code, state } = idp.authorize(location)
  const callback = await fetch(
    `${base}/auth/oidc/callback?code=${code}&state=${options.state ?? state}`,
    { redirect: 'manual', headers: options.cookie === false || !cookie ? {} : { cookie } },
  )
  return { started, location, callback, state }
}

const failed = (res: Response) => res.headers.get('location')?.startsWith('/login?error=')
const signedIn = (res: Response) => !!res.headers.get('set-cookie')?.includes('magpie_session=')

describe('OpenID Connect login', () => {
  it('offers a button, sends the browser to the provider with PKCE, and signs them in', async () => {
    await start()
    const page = await (await fetch(base + '/login')).text()
    expect(page).toContain('Sign in with Authelia')

    const { started, location, callback } = await login()
    expect(started.status).toBe(303)
    const target = new URL(location)
    expect(target.origin + target.pathname).toBe(`${idp.issuer}/authorize`)
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'magpie',
      scope: 'openid profile email groups',
      code_challenge_method: 'S256',
      redirect_uri: `${base}/auth/oidc/callback`,
    })
    expect(started.headers.get('set-cookie')).toMatch(/HttpOnly/)

    expect(signedIn(callback)).toBe(true)
    expect(callback.headers.get('location')).toBe('/movies')
    expect(ctx.auth.users()).toEqual([
      expect.objectContaining({ username: 'amy', role: 'manager', methods: ['oidc'] }),
    ])
    // the client secret was sent as HTTP Basic, with the verifier and no secret in the body
    const request = idp.tokenRequests[0]!
    expect(request.auth).toBe(`Basic ${Buffer.from('magpie:shh').toString('base64')}`)
    expect(request.body.get('client_secret')).toBeNull()
    expect(request.body.get('code_verifier')).toBeTruthy()
  })

  it('finds the same user next time and follows group changes', async () => {
    await start()
    await login()
    idp.claims = { ...idp.claims, groups: ['admins'] }
    expect(signedIn((await login()).callback)).toBe(true)
    expect(ctx.auth.users()).toHaveLength(1)
    expect(ctx.auth.users()[0]!.role).toBe('admin')
  })

  it('refuses people whose groups do not let them in', async () => {
    await start()
    idp.claims = { sub: 'sam-1', preferred_username: 'sam', groups: ['guests'] }
    const { callback } = await login()
    expect(failed(callback)).toBe(true)
    expect(callback.headers.get('location')).toMatch(/not%20allowed/)
    expect(ctx.auth.users()).toEqual([])
  })

  it('can let everyone in as one role', async () => {
    await start({ defaultRole: 'viewer' })
    idp.claims = { sub: 'sam-1', preferred_username: 'sam' }
    expect(signedIn((await login()).callback)).toBe(true)
    expect(ctx.auth.users()[0]!.role).toBe('viewer')
  })

  it('reads groups and names from userinfo when the ID token leaves them out', async () => {
    await start()
    idp.claims = { sub: 'amy-1' }
    idp.userinfo = { sub: 'amy-1', preferred_username: 'amy', groups: ['admins'] }
    expect(signedIn((await login()).callback)).toBe(true)
    expect(ctx.auth.users()[0]).toMatchObject({ username: 'amy', role: 'admin' })
  })

  it('ignores userinfo about someone else', async () => {
    await start()
    idp.claims = { sub: 'amy-1', preferred_username: 'amy' }
    idp.userinfo = { sub: 'someone-else', groups: ['admins'] }
    // no groups for amy, and the default is none
    expect(failed((await login()).callback)).toBe(true)
  })

  it('names a new user from the email when there is no username claim', async () => {
    await start({ defaultRole: 'viewer', groupsClaim: '' })
    idp.claims = { sub: 'x-1', email: 'kim@example.com' }
    await login()
    expect(ctx.auth.users()[0]!.username).toBe('kim')
  })

  it('does not hand an existing user to a provider user with the same name', async () => {
    await start()
    ctx.auth.createUser('amy', 'admin')
    await login()
    expect(ctx.auth.users().map((u) => [u.username, u.role])).toEqual([
      ['amy', 'admin'],
      ['amy-2', 'manager'],
    ])
  })

  it('can match existing users by name when told the provider’s names are trusted', async () => {
    await start({ matchUsername: true })
    const amy = ctx.auth.createUser('amy', 'viewer')
    expect(signedIn((await login()).callback)).toBe(true)
    expect(ctx.auth.users()).toHaveLength(1)
    expect(ctx.auth.user(amy.id)?.role).toBe('manager')
  })

  it('does not sign in switched-off users', async () => {
    await start()
    await login()
    ctx.auth.createUser('root', 'admin')
    ctx.auth.updateUser(ctx.auth.userByName('amy')!.id, { disabled: true })
    const { callback } = await login()
    expect(failed(callback)).toBe(true)
    expect(signedIn(callback)).toBe(false)
  })
})

describe('what the callback checks', () => {
  it('refuses a callback from another browser, a made-up state, and a replay', async () => {
    await start()
    expect(failed((await login({ cookie: false })).callback)).toBe(true)
    expect(failed((await login({ state: 'made-up' })).callback)).toBe(true)

    const first = await login()
    expect(signedIn(first.callback)).toBe(true)
    const cookie = first.started.headers.get('set-cookie')!.split(';')[0]!
    const replay = await fetch(`${base}/auth/oidc/callback?code=x&state=${first.state}`, {
      redirect: 'manual',
      headers: { cookie },
    })
    expect(failed(replay)).toBe(true)
  })

  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['another client', { aud: 'someone-else' }],
    ['an old token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['the wrong nonce', { nonce: 'not-the-one' }],
    ['no subject', { sub: '' }],
  ])('refuses an ID token for %s', async (_name, claims) => {
    await start()
    idp.claims = { sub: 'amy-1', preferred_username: 'amy', groups: ['admins'], ...claims }
    const { callback } = await login()
    expect(failed(callback)).toBe(true)
    expect(ctx.auth.users()).toEqual([])
  })

  it('refuses a provider that answers for a different issuer', async () => {
    await start()
    idp.overrides = { issuer: 'https://evil.example' }
    expect(failed(await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' }))).toBe(true)
  })

  it('reports a provider that refuses the login', async () => {
    await start()
    const started = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' })
    const { state } = idp.authorize(started.headers.get('location')!)
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!
    const res = await fetch(`${base}/auth/oidc/callback?error=access_denied&state=${state}`, {
      redirect: 'manual',
      headers: { cookie },
    })
    expect(failed(res)).toBe(true)
  })

  it('refuses a callback whose code the provider rejects', async () => {
    await start()
    const started = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' })
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!
    const res = await fetch(`${base}/auth/oidc/callback?code=forged&state=${state}`, {
      redirect: 'manual',
      headers: { cookie },
    })
    expect(failed(res)).toBe(true)
    expect(ctx.auth.users()).toEqual([])
  })

  it('sends the secret in the body when the provider only takes that', async () => {
    await start()
    idp.overrides = { token_endpoint_auth_methods_supported: ['client_secret_post'] }
    expect(signedIn((await login()).callback)).toBe(true)
    expect(idp.tokenRequests[0]!.auth).toBeUndefined()
    expect(idp.tokenRequests[0]!.body.get('client_secret')).toBe('shh')
  })
})

describe('setup', () => {
  it('refuses an issuer that is not https, except on this machine', async () => {
    const ctx = new Context()
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(DatabaseService, { path: ':memory:' })
    await ctx.plugin(AuthService)
    const config = { issuer: 'http://auth.example.com', clientId: 'x' } as AuthOidc.Config
    await expect(ctx.plugin(AuthOidc, config)).rejects.toThrow(/https/)
    ctx.server._http.close()
  })
})
