// The server side of auth: the guard that every request and WebSocket passes, and the
// login page. Everything except the login page and the identity providers' own routes
// (under /auth/) needs a session cookie or, under /api/, an API key.

import type { Context } from 'cordis'
import type AuthService from './index'
import { loginPage } from './login'
import { allowUpgrade } from './policy'
import { COOKIE, html, readCookie, redirect, safeNext } from './web'

export { COOKIE, readCookie } from './web'

export function installGuard(ctx: Context, auth: AuthService) {
  const open = (path: string) => path === '/login' || path.startsWith('/auth/')
  ctx.server.use(async (req, res, next) => {
    if (open(req.path)) return next()
    const who = auth.authenticate(req) ?? auth.autoLogin(req, res)
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

  server.get('/login', async (req, res) => {
    const next = safeNext(req.query.get('next'))
    if (auth.authenticate(req) ?? auth.autoLogin(req, res)) return redirect(res, next)
    const view = {
      next,
      error: req.query.get('error') ?? undefined,
      setup: !auth.hasUsers(),
    }
    const providers = auth.providers.list()
    // with no user yet, a provider that can create the first one takes the page
    const setup = view.setup ? providers.flatMap((p) => p.setup?.(view) ?? []) : []
    const sections = setup.length ? setup : providers.flatMap((p) => p.login?.(view) ?? [])
    html(
      res,
      loginPage({
        title: setup.length ? 'Create your account' : 'Log in',
        intro: setup.length
          ? 'This is the first start. Choose the login for this Magpie.'
          : undefined,
        error: sections.length ? view.error : 'No sign-in method is enabled.',
        sections,
      }),
    )
  })

  server.get('/auth/status', async (req, res) => {
    const who = auth.authenticate(req)
    res.status = who ? 200 : 401
    res.json({ authenticated: !!who, setup: !auth.hasUsers() })
  })

  server.post('/auth/logout', async (req, res) => {
    const cookie = readCookie(req.headers.get('cookie'), COOKIE)
    if (cookie) auth.endSession(cookie)
    res.headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    redirect(res, '/login')
  })
}

function safeHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}
