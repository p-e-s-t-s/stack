// The server side of auth: the guard that every request and WebSocket passes, and the
// login routes. Everything except the login page needs a session cookie or, under /api/,
// an API key.

import type { Request, Response } from '@cordisjs/plugin-server'
import type { Context } from 'cordis'
import type AuthService from './index'
import { FailureLimiter } from './limiter'
import { loginPage } from './login'
import { allowUpgrade } from './policy'

export const COOKIE = 'magpie_session'

/** Failed logins allowed per address, and per username, in a window before a wait. */
const MAX_FAILURES = 10
const FAILURE_WINDOW = 15 * 60_000

export function installGuard(ctx: Context, auth: AuthService) {
  const open = (path: string) => path === '/login' || path.startsWith('/auth/')
  ctx.server.use(async (req, res, next) => {
    if (open(req.path)) return next()
    const who = auth.authenticate(req)
    if (who) {
      auth.remember(req, who)
      return next()
    }
    if (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts('html')) {
      redirect(res, `/login?next=${encodeURIComponent(req.url)}`)
    } else {
      res.status = 401
      res.json({ error: 'log in or send an API key' })
    }
  })
  // the web console's WebSocket: a session, from a page on this same host
  ctx.on(
    'server/upgrade',
    async (req, next) => {
      const origin = req.headers.get('origin')
      const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
      const sameHost = !origin || safeHost(origin) === host
      const cookie = readCookie(req.headers.get('cookie'), COOKIE)
      const who = sameHost && cookie ? auth.session(cookie) : undefined
      if (who) {
        allowUpgrade(req, who)
        return next()
      }
      req._req.socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    },
    { prepend: true },
  )
}

export function installRoutes(ctx: Context, auth: AuthService) {
  const server = ctx.server
  const addresses = new FailureLimiter(MAX_FAILURES, FAILURE_WINDOW)
  const usernames = new FailureLimiter(MAX_FAILURES, FAILURE_WINDOW)

  const loginFailed = (res: Response, error: string, next: string) =>
    redirect(res, `/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`)

  server.get('/login', async (req, res) => {
    if (auth.authenticate(req)) return redirect(res, safeNext(req.query.get('next')))
    html(
      res,
      loginPage({
        setup: !auth.hasUsers(),
        next: safeNext(req.query.get('next')),
        error: req.query.get('error') ?? undefined,
      }),
    )
  })

  server.get('/auth/status', async (req, res) => {
    const who = auth.authenticate(req)
    res.status = who ? 200 : 401
    res.json({ authenticated: !!who, setup: !auth.hasUsers() })
  })

  server.post('/auth/setup', async (req, res) => {
    const form = await readForm(req)
    const next = safeNext(form.get('next'))
    const password = form.get('password') ?? ''
    if (password !== form.get('confirm')) return loginFailed(res, 'the passwords differ', next)
    try {
      const user = await auth.setup(form.get('username') ?? '', password)
      ctx.logger.info('created the administrator login for %s', user.username)
      startSession(auth, req, res, user.id, next)
    } catch (error) {
      loginFailed(res, (error as Error).message, next)
    }
  })

  server.post('/auth/login', async (req, res) => {
    const form = await readForm(req)
    const next = safeNext(form.get('next'))
    const address = clientAddress(auth, req)
    const username = (form.get('username') ?? '').trim().toLowerCase()
    if (addresses.blocked(address) || usernames.blocked(username)) {
      return loginFailed(res, 'too many failed attempts; try again in a few minutes', next)
    }
    const user = await auth.verify(form.get('username') ?? '', form.get('password') ?? '')
    if (!user) {
      addresses.fail(address)
      usernames.fail(username)
      ctx.logger.warn('failed login for %s from %s', username, address)
      return loginFailed(res, 'wrong username or password', next)
    }
    if (user.disabled) return loginFailed(res, 'this account is switched off', next)
    addresses.clear(address)
    usernames.clear(username)
    auth.markLogin(user.id)
    startSession(auth, req, res, user.id, next)
  })

  server.post('/auth/logout', async (req, res) => {
    const cookie = readCookie(req.headers.get('cookie'), COOKIE)
    if (cookie) auth.endSession(cookie)
    res.headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    redirect(res, '/login')
  })
}

function startSession(
  auth: AuthService,
  req: Request,
  res: Response,
  userId: number,
  next: string,
) {
  const value = auth.createSession(userId, {
    address: clientAddress(auth, req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  })
  const secure =
    auth.config.trustProxy && req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : ''
  res.headers.append(
    'set-cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.config.sessionDays * 86_400}${secure}`,
  )
  redirect(res, next)
}

/** The caller's address; behind a trusted proxy, the one it reports. */
function clientAddress(auth: AuthService, req: Request) {
  if (auth.config.trustProxy) {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return req._req.socket.remoteAddress ?? ''
}

export function readCookie(header: string | null, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || undefined
  }
}

async function readForm(req: Request) {
  return new URLSearchParams(await req.text())
}

/** Only same-site paths, so the login page can't be used to send people elsewhere. */
function safeNext(next: string | null | undefined) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/'
}

function safeHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

function redirect(res: Response, location: string) {
  res.status = 303
  res.headers.set('location', location)
}

function html(res: Response, body: string) {
  res.status = 200
  res.headers.set('content-type', 'text/html; charset=utf-8')
  res.headers.set('cache-control', 'no-store')
  res.body = body
}
