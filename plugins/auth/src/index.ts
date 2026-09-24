// @magpiejs/auth: one login for the web console, its WebSocket and the API, plus API
// keys for other programs (docs/phase-3.md §4.5). Everything except the login page needs
// a session cookie or, under /api/, an API key.

import type {} from '@cordisjs/plugin-server'
import type { Request, Response } from '@cordisjs/plugin-server'
import type { Drizzle } from '@magpiejs/database'
import { type Context, Service } from 'cordis'
import { desc, eq, lt } from 'drizzle-orm'
import z from 'schemastery'
import console_ from './console'
import { loginPage } from './login'
import { hashPassword, sha256, token, verifyPassword } from './password'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    auth: AuthService
  }
}

export type Identity =
  { type: 'session'; user: schema.User } | { type: 'api-key'; key: schema.ApiKey }

export interface Config {
  sessionDays: number
}

export const Config: z<Config> = z.object({
  sessionDays: z.natural().min(1).default(30).description('Days a login lasts without use.'),
})

const COOKIE = 'magpie_session'
const DAY = 86_400_000
const MIN_PASSWORD = 8
/** Failed logins allowed per address in a window before it has to wait. */
const MAX_FAILURES = 10
const FAILURE_WINDOW = 15 * 60_000

export class AuthService extends Service {
  static inject = ['database', 'server']

  db!: Drizzle<typeof schema>
  /** Who made each request, set by the guard. */
  private identities = new WeakMap<object, Identity>()
  private failures = new Map<string, { count: number; since: number }>()

  constructor(
    ctx: Context,
    public config: Config = { sessionDays: 30 },
  ) {
    super(ctx, 'auth')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'auth',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.guard()
    this.routes()
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  // ---- users

  hasUsers() {
    return !!this.db.select({ id: schema.users.id }).from(schema.users).limit(1).get()
  }

  users() {
    return this.db.select().from(schema.users).all()
  }

  async createUser(username: string, password: string) {
    username = username.trim()
    if (!username) throw new Error('enter a username')
    if (password.length < MIN_PASSWORD)
      throw new Error(`the password needs at least ${MIN_PASSWORD} characters`)
    return this.db
      .insert(schema.users)
      .values({ username, passwordHash: await hashPassword(password), createdAt: Date.now() })
      .returning()
      .get()
  }

  async verify(username: string, password: string) {
    const user = this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username.trim()))
      .get()
    // hash anyway so a wrong username takes as long as a wrong password
    const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$AAAA$AAAA')
    return ok ? user : undefined
  }

  /** Changes a password and ends that user's other sessions. */
  async changePassword(userId: number, current: string, next: string, keepSession?: string) {
    const user = this.db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
    if (!user || !(await verifyPassword(current, user.passwordHash)))
      throw new Error('the current password is wrong')
    if (next.length < MIN_PASSWORD)
      throw new Error(`the password needs at least ${MIN_PASSWORD} characters`)
    this.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(schema.users.id, userId))
      .run()
    for (const s of this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .all()) {
      if (s.id !== (keepSession && sha256(keepSession)))
        this.db.delete(schema.sessions).where(eq(schema.sessions.id, s.id)).run()
    }
  }

  // ---- sessions

  createSession(userId: number) {
    const now = Date.now()
    this.db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run()
    const value = token()
    this.db
      .insert(schema.sessions)
      .values({
        id: sha256(value),
        userId,
        createdAt: now,
        expiresAt: now + this.config.sessionDays * DAY,
      })
      .run()
    return value
  }

  /** The user of a live session, extending it when it is past half its life. */
  sessionUser(value: string) {
    const id = sha256(value)
    const session = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    const now = Date.now()
    if (!session || session.expiresAt < now) return
    const lifetime = this.config.sessionDays * DAY
    if (session.expiresAt - now < lifetime / 2) {
      this.db
        .update(schema.sessions)
        .set({ expiresAt: now + lifetime })
        .where(eq(schema.sessions.id, id))
        .run()
    }
    return this.db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()
  }

  endSession(value: string) {
    this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, sha256(value)))
      .run()
  }

  // ---- API keys

  /** Creates a key. The returned `key` is shown once; only its hash is stored. */
  createApiKey(name: string) {
    const key = token(24)
    const row = this.db
      .insert(schema.apiKeys)
      .values({
        name: name.trim() || 'API key',
        keyHash: sha256(key),
        prefix: key.slice(0, 6),
        createdAt: Date.now(),
      })
      .returning()
      .get()
    return { key, row }
  }

  apiKeys() {
    return this.db.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.createdAt)).all()
  }

  revokeApiKey(id: number) {
    this.db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id)).run()
  }

  checkApiKey(key: string) {
    const row = this.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, sha256(key)))
      .get()
    if (!row) return
    this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: Date.now() })
      .where(eq(schema.apiKeys.id, row.id))
      .run()
    return row
  }

  // ---- requests

  /** Who made a request that passed the guard. */
  identity(req: Request) {
    return this.identities.get(req._req)
  }

  authenticate(req: Request): Identity | undefined {
    const cookie = readCookie(req.headers.get('cookie'), COOKIE)
    const user = cookie && this.sessionUser(cookie)
    if (user) return { type: 'session', user }
    if (!req.path.startsWith('/api/')) return
    const key = req.headers.get('x-api-key') ?? req.query.get('apikey')
    const row = key && this.checkApiKey(key)
    if (row) return { type: 'api-key', key: row }
  }

  private guard() {
    const open = (path: string) => path === '/login' || path.startsWith('/auth/')
    this.ctx.server.use(async (req, res, next) => {
      if (open(req.path)) return next()
      const who = this.authenticate(req)
      if (who) {
        this.identities.set(req._req, who)
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
    this.ctx.on(
      'server/upgrade',
      async (req, next) => {
        const origin = req.headers.get('origin')
        const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
        const sameHost = !origin || safeHost(origin) === host
        const cookie = readCookie(req.headers.get('cookie'), COOKIE)
        if (sameHost && cookie && this.sessionUser(cookie)) return next()
        const socket = req._req.socket
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      },
      { prepend: true },
    )
  }

  private routes() {
    const server = this.ctx.server
    server.get('/login', async (req, res) => {
      if (this.authenticate(req)) return redirect(res, safeNext(req.query.get('next')))
      html(
        res,
        loginPage({
          setup: !this.hasUsers(),
          next: safeNext(req.query.get('next')),
          error: req.query.get('error') ?? undefined,
        }),
      )
    })

    server.get('/auth/status', async (req, res) => {
      const who = this.authenticate(req)
      res.status = who ? 200 : 401
      res.json({ authenticated: !!who, setup: !this.hasUsers() })
    })

    server.post('/auth/setup', async (req, res) => {
      const form = await readForm(req)
      const next = safeNext(form.get('next'))
      const fail = (error: string) =>
        redirect(res, `/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`)
      if (this.hasUsers()) return fail('an account already exists; log in')
      const password = form.get('password') ?? ''
      if (password !== form.get('confirm')) return fail('the passwords differ')
      try {
        const user = await this.createUser(form.get('username') ?? '', password)
        this.ctx.logger.info('created the login for %s', user.username)
        this.startSession(req, res, user.id, next)
      } catch (error) {
        fail((error as Error).message)
      }
    })

    server.post('/auth/login', async (req, res) => {
      const form = await readForm(req)
      const next = safeNext(form.get('next'))
      const address = req._req.socket.remoteAddress ?? ''
      const now = Date.now()
      let failed = this.failures.get(address)
      if (failed && now - failed.since > FAILURE_WINDOW) this.failures.delete(address)
      failed = this.failures.get(address)
      if (failed && failed.count >= MAX_FAILURES) {
        const error = 'too many failed attempts; try again in a few minutes'
        return redirect(
          res,
          `/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`,
        )
      }
      const user = await this.verify(form.get('username') ?? '', form.get('password') ?? '')
      if (!user) {
        this.failures.set(address, { count: (failed?.count ?? 0) + 1, since: failed?.since ?? now })
        this.ctx.logger.warn('failed login from %s', address)
        const error = 'wrong username or password'
        return redirect(
          res,
          `/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`,
        )
      }
      this.failures.delete(address)
      this.startSession(req, res, user.id, next)
    })

    server.post('/auth/logout', async (req, res) => {
      const cookie = readCookie(req.headers.get('cookie'), COOKIE)
      if (cookie) this.endSession(cookie)
      res.headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
      redirect(res, '/login')
    })
  }

  private startSession(req: Request, res: Response, userId: number, next: string) {
    const value = this.createSession(userId)
    const secure = req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : ''
    res.headers.append(
      'set-cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.config.sessionDays * 86_400}${secure}`,
    )
    redirect(res, next)
  }
}

function readCookie(header: string | null, name: string) {
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

export default AuthService
