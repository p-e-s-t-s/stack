// @magpiejs/auth-oidc: log in with an OpenID Connect provider (Authelia, Authentik,
// Keycloak, Google…) using the authorization code flow with PKCE.
//
// The ID token is taken from the provider's token endpoint over TLS, which OpenID Connect
// (Core §3.1.3.7) accepts in place of checking its signature, so no keys are fetched; its
// issuer, audience, expiry and nonce are checked. For that reason the issuer must be
// https (a loopback address is let through for local testing).

import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from '@cordisjs/plugin-server'
import type {} from '@magpiejs/auth'
import { roleFromGroups, roleRulesSchema, type RoleRules } from '@magpiejs/auth/mapping'
import { FailureLimiter, escapeHtml, readCookie, redirect, safeNext } from '@magpiejs/auth/web'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'auth-oidc'
export const inject = ['auth', 'server']

export interface Config extends RoleRules {
  label: string
  issuer: string
  clientId: string
  clientSecret: string
  scopes: string
  usernameClaim: string
  groupsClaim: string
  redirectUrl: string
  syncRoles: boolean
  matchUsername: boolean
}

export const Config: z<Config> = z.object({
  label: z.string().default('Single sign-on').description('Shown on the login button.'),
  issuer: z
    .string()
    .required()
    .description(
      'The provider’s address, e.g. https://auth.example.com. Magpie reads its settings from there.',
    ),
  clientId: z.string().required().description('The client id the provider gave Magpie.'),
  clientSecret: z
    .string()
    .role('secret')
    .default('')
    .description('The client secret. Leave empty for a public client; PKCE is used either way.'),
  scopes: z
    .string()
    .default('openid profile email')
    .description('Scopes to ask for. Add `groups` to read groups.'),
  usernameClaim: z
    .string()
    .default('preferred_username')
    .description(
      'Claim with the name for a new user. Falls back to the email’s first part, then the subject.',
    ),
  groupsClaim: z
    .string()
    .default('groups')
    .description('Claim with the user’s groups. Empty to ignore groups.'),
  ...roleRulesSchema('none'),
  redirectUrl: z
    .string()
    .default('')
    .description(
      'Magpie’s callback address as the provider has it registered. Empty works it out from the ' +
        'request: <address>/auth/oidc/callback.',
    ),
  syncRoles: z
    .boolean()
    .default(true)
    .description('Set the role from the groups on every login, not only the first.'),
  matchUsername: z
    .boolean()
    .default(false)
    .description(
      'Sign in as an existing Magpie user with the same name. Only turn on if the provider only ' +
        'lets in people whose names you trust: it gives them that user’s access.',
    ),
})

/** What the provider says about itself at /.well-known/openid-configuration. */
interface Metadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  token_endpoint_auth_methods_supported?: string[]
}

interface Pending {
  nonce: string
  verifier: string
  next: string
  redirectUri: string
  expires: number
}

const COOKIE = 'magpie_oidc'
const PENDING_MS = 10 * 60_000
const LEEWAY_S = 60
const TIMEOUT_MS = 10_000

const b64url = (buffer: Buffer) => buffer.toString('base64url')

export function apply(ctx: Context, config: Config) {
  const issuer = config.issuer.replace(/\/+$/, '')
  const url = new URL(issuer)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback)
    throw new Error('the OpenID Connect issuer must be an https address')

  const pending = new Map<string, Pending>()
  const failures = new FailureLimiter()
  let metadata: { value: Metadata; expires: number } | undefined

  async function discover() {
    if (metadata && metadata.expires > Date.now()) return metadata.value
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`the provider's settings could not be read (${res.status})`)
    const value = (await res.json()) as Metadata
    // the settings must be for the issuer asked, or anyone could vouch for it
    if (value.issuer?.replace(/\/+$/, '') !== issuer)
      throw new Error('the provider reports a different issuer than configured')
    if (!value.authorization_endpoint || !value.token_endpoint)
      throw new Error('the provider has no authorization or token endpoint')
    metadata = { value, expires: Date.now() + 60 * 60_000 }
    return value
  }

  const redirectUri = (req: Request) =>
    config.redirectUrl || `${ctx.auth.origin(req)}/auth/oidc/callback`

  const fail = (res: Response, message: string, next = '/') => {
    res.headers.append(
      'set-cookie',
      `${COOKIE}=; Path=/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=0`,
    )
    ctx.auth.loginFailed(res, message, next)
  }

  ctx.effect(
    () =>
      ctx.auth.providers.register({
        id: 'oidc',
        label: config.label,
        login: (view) =>
          `<a class="button" href="/auth/oidc/start?next=${encodeURIComponent(view.next)}">Sign in with ${escapeHtml(config.label)}</a>`,
      }),
    'auth-oidc: identity provider',
  )

  ctx.server.get('/auth/oidc/start', async (req, res) => {
    const next = safeNext(req.query.get('next'))
    try {
      const meta = await discover()
      const now = Date.now()
      for (const [key, value] of pending) if (value.expires < now) pending.delete(key)
      // a flood of starts must not grow the table without end
      if (pending.size >= 500)
        return fail(res, 'too many logins are in progress; try again shortly', next)

      const state = b64url(randomBytes(24))
      const verifier = b64url(randomBytes(48))
      const nonce = b64url(randomBytes(24))
      const uri = redirectUri(req)
      pending.set(state, { nonce, verifier, next, redirectUri: uri, expires: now + PENDING_MS })

      const target = new URL(meta.authorization_endpoint)
      target.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: uri,
        scope: config.scopes,
        state,
        nonce,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      }).toString()
      // the cookie ties the callback to this browser, so nobody can be logged in as
      // someone else by being sent a callback link
      const secure = uri.startsWith('https:') ? '; Secure' : ''
      res.headers.append(
        'set-cookie',
        `${COOKIE}=${state}; Path=/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${PENDING_MS / 1000}${secure}`,
      )
      redirect(res, target.toString())
    } catch (error) {
      ctx.logger.warn('could not start the OpenID Connect login: %s', (error as Error).message)
      fail(res, 'the sign-in provider could not be reached', next)
    }
  })

  ctx.server.get('/auth/oidc/callback', async (req, res) => {
    const address = ctx.auth.clientAddress(req)
    if (failures.blocked(address))
      return fail(res, 'too many failed attempts; try again in a few minutes')
    const state = req.query.get('state') ?? ''
    const login = pending.get(state)
    // each state works once, and only in the browser that started it
    pending.delete(state)
    if (
      !login ||
      login.expires < Date.now() ||
      readCookie(req.headers.get('cookie'), COOKIE) !== state
    ) {
      failures.fail(address)
      return fail(res, 'that login expired or did not start here; try again')
    }
    const error = req.query.get('error')
    if (error) {
      ctx.logger.info(
        'the provider refused a login: %s %s',
        error,
        req.query.get('error_description') ?? '',
      )
      return fail(res, 'the sign-in provider did not log you in', login.next)
    }
    try {
      const claims = await exchange(req.query.get('code') ?? '', login)
      const groups = readGroups(claims[config.groupsClaim])
      const role = roleFromGroups(groups, config)
      if (!role) {
        ctx.logger.info('%s has no group that lets them in', String(claims.sub))
        return fail(res, 'your account is not allowed to use Magpie', login.next)
      }
      const username =
        text(claims[config.usernameClaim]) ??
        text(claims.email)?.split('@')[0] ??
        String(claims.sub)
      const user = ctx.auth.resolveExternal({
        provider: 'oidc',
        subject: `${issuer}#${claims.sub}`,
        username,
        create: { role },
        role: config.syncRoles && config.groupsClaim ? role : undefined,
        matchUsername: config.matchUsername,
      })
      if (!user) return fail(res, 'your account is not allowed to use Magpie', login.next)
      res.headers.append(
        'set-cookie',
        `${COOKIE}=; Path=/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=0`,
      )
      ctx.auth.signIn(req, res, user, login.next)
    } catch (e) {
      failures.fail(address)
      ctx.logger.warn('an OpenID Connect login failed: %s', (e as Error).message)
      fail(res, 'the sign-in provider’s answer could not be accepted', login.next)
    }
  })

  /** Trades the code for tokens and returns the user's checked claims. */
  async function exchange(code: string, login: Pending) {
    if (!code) throw new Error('no code')
    const meta = await discover()
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: login.redirectUri,
      code_verifier: login.verifier,
      client_id: config.clientId,
    })
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    }
    if (config.clientSecret) {
      const methods = meta.token_endpoint_auth_methods_supported
      if (
        methods &&
        !methods.includes('client_secret_basic') &&
        methods.includes('client_secret_post')
      )
        body.set('client_secret', config.clientSecret)
      else
        headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`
    }
    const res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const tokens = (await res.json().catch(() => ({}))) as {
      id_token?: string
      access_token?: string
      error?: string
    }
    if (!res.ok || !tokens.id_token)
      throw new Error(`token request failed: ${res.status} ${tokens.error ?? ''}`)

    const claims = decode(tokens.id_token)
    const audience = ([] as unknown[]).concat(claims.aud)
    const now = Date.now() / 1000
    if (String(claims.iss).replace(/\/+$/, '') !== issuer)
      throw new Error('the ID token is from another issuer')
    if (!audience.includes(config.clientId)) throw new Error('the ID token is for another client')
    if (audience.length > 1 && claims.azp !== config.clientId)
      throw new Error('the ID token has the wrong authorized party')
    if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < now)
      throw new Error('the ID token has expired')
    if (claims.nonce !== login.nonce) throw new Error('the ID token has the wrong nonce')
    if (typeof claims.sub !== 'string' || !claims.sub)
      throw new Error('the ID token has no subject')

    // some providers keep groups (or the name) out of the ID token
    const missing =
      (config.groupsClaim && claims[config.groupsClaim] === undefined) ||
      claims[config.usernameClaim] === undefined
    if (missing && meta.userinfo_endpoint && tokens.access_token) {
      const info = await fetch(meta.userinfo_endpoint, {
        headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (info.ok) {
        const extra = (await info.json()) as Record<string, unknown>
        // only the same person's details are accepted
        if (extra.sub === claims.sub) return { ...extra, ...claims }
      }
    }
    return claims
  }
}

function decode(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1]
  if (!payload) throw new Error('the ID token is not a JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** Groups arrive as a list, or as one string separated by commas or spaces. */
function readGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean)
  return []
}
