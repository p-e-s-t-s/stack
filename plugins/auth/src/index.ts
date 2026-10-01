// @magpiejs/auth: users with roles, sessions and API keys for the web console, its
// WebSocket and the API (docs/phase-3.md §4.5, docs/auth.md). This file is the service:
// accounts, sessions, keys and the permission check. http.ts guards the server and serves
// the login routes; policy.ts connects it to the web console.

import type { Request, Response } from '@cordisjs/plugin-server'
import type { Drizzle } from '@magpiejs/database'
import { type Context, Service } from 'cordis'
import { and, desc, eq, lt, ne } from 'drizzle-orm'
import z from 'schemastery'
import console_ from './console'
import { installGuard, installRoutes } from './http'
import { KEY_ROLES, type Permission, type Role, isRole, roleAtMost, roleCan } from './permissions'
import { installPolicy, SocketRegistry } from './policy'
import { type ExternalLogin, ProviderRegistry } from './providers'
import routes from './routes'
import * as schema from './schema'
import { sha256, token } from './tokens'
import { COOKIE, readCookie, redirect } from './web'

export * from './schema'
export * from './permissions'
export * from './providers'

declare module 'cordis' {
  interface Context {
    auth: AuthService
  }
}

export type Identity =
  | { type: 'session'; user: schema.User; sessionId: string }
  | { type: 'api-key'; key: schema.ApiKey; role: Role }

/** A user without their password hash. */
export interface UserInfo {
  id: number
  username: string
  role: Role
  disabled: boolean
  createdAt: number
  lastLoginAt: number | null
  /** Ids of the identity providers this user can sign in with. */
  methods: string[]
}

export interface SessionInfo {
  id: string
  createdAt: number
  lastSeenAt: number | null
  address: string | null
  userAgent: string | null
  current: boolean
}

export interface ApiKeyInfo {
  id: number
  name: string
  prefix: string
  role: Role
  /** The user who made it; `null` for keys from before users had roles. */
  owner: string | null
  createdAt: number
  lastUsedAt: number | null
}

export interface Config {
  sessionDays: number
  trustProxy: boolean
}

export const Config: z<Config> = z.object({
  sessionDays: z.natural().min(1).default(30).description('Days a login lasts without use.'),
  trustProxy: z
    .boolean()
    .default(false)
    .description(
      'Believe X-Forwarded-For and X-Forwarded-Proto. Turn on behind a reverse proxy, so ' +
        'login limits count real addresses and cookies are marked Secure over https.',
    ),
})

const DAY = 86_400_000
/** Writes of "last seen" and "last used" are skipped when the last one is this recent. */
const TOUCH_INTERVAL = 60_000

export class AuthService extends Service {
  static inject = ['database', 'server']

  db!: Drizzle<typeof schema>
  /** Who made each request, set by the guard. */
  private identities = new WeakMap<object, Identity>()
  /** Open console sockets, to close them when their user's access changes. */
  sockets = new SocketRegistry()
  /** The identity providers that are loaded: how people prove who they are. */
  providers = new ProviderRegistry()

  constructor(
    ctx: Context,
    public config: Config = { sessionDays: 30, trustProxy: false },
  ) {
    super(ctx, 'auth')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'auth',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    installGuard(this.ctx, this)
    installRoutes(this.ctx, this)
    this.ctx.inject(['api'], (ctx) => void ctx.plugin(routes, this))
    this.ctx.inject(['webui'], (ctx) => {
      installPolicy(ctx, this)
      ctx.plugin(console_, this)
    })
  }

  // ---- permissions

  roleOf(identity: Identity | undefined): Role | undefined {
    if (!identity) return
    const role = identity.type === 'session' ? identity.user.role : identity.role
    return isRole(role) ? role : undefined
  }

  /** Whether the caller holds a permission. No caller, or an unknown role, holds none. */
  can(identity: Identity | undefined, permission: Permission) {
    const role = this.roleOf(identity)
    return !!role && roleCan(role, permission)
  }

  // ---- users

  hasUsers() {
    return !!this.db.select({ id: schema.users.id }).from(schema.users).limit(1).get()
  }

  users(): UserInfo[] {
    const linked = new Map<number, Set<string>>()
    for (const link of this.db.select().from(schema.identities).all()) {
      if (!linked.has(link.userId)) linked.set(link.userId, new Set())
      linked.get(link.userId)!.add(link.provider)
    }
    return this.db
      .select()
      .from(schema.users)
      .orderBy(schema.users.username)
      .all()
      .map((user) => {
        const methods = new Set(linked.get(user.id))
        for (const p of this.providers.list()) if (p.knows?.(user.id)) methods.add(p.id)
        return toInfo(user, [...methods].sort())
      })
  }

  user(id: number) {
    return this.db.select().from(schema.users).where(eq(schema.users.id, id)).get()
  }

  /** Makes the first account, an administrator. Fails once any account exists. */
  createFirstAdmin(username: string) {
    username = checkUsername(username)
    if (this.hasUsers()) throw new Error('an account already exists; log in')
    return this.insertUser(username, 'admin')
  }

  /** Makes a user. How they sign in is up to the identity providers. */
  createUser(username: string, role: Role) {
    username = checkUsername(username)
    if (!isRole(role)) throw new Error('choose a role')
    return this.insertUser(username, role)
  }

  private insertUser(username: string, role: Role) {
    try {
      return this.db
        .insert(schema.users)
        .values({ username, role, createdAt: Date.now() })
        .returning()
        .get()
    } catch (error) {
      if (isUniqueViolation(error))
        throw new Error(`the username ${username} is taken`, { cause: error })
      throw error
    }
  }

  /** Changes a user's role or switches them off. The last active administrator stays. */
  updateUser(id: number, change: { role?: Role; disabled?: boolean }) {
    const user = this.requireUser(id)
    if (change.role !== undefined && !isRole(change.role)) throw new Error('choose a role')
    const role = change.role ?? (user.role as Role)
    const disabled = change.disabled ?? user.disabled
    if (user.role === 'admin' && !user.disabled && (role !== 'admin' || disabled))
      this.requireOtherAdmin(id)
    this.db.update(schema.users).set({ role, disabled }).where(eq(schema.users.id, id)).run()
    if (disabled) this.endSessions(id)
    // an open console keeps the role it connected with, so make it reconnect
    this.sockets.close((s) => s.userId === id)
  }

  deleteUser(id: number, actingId?: number) {
    const user = this.requireUser(id)
    if (id === actingId) throw new Error('you cannot delete your own account')
    if (user.role === 'admin' && !user.disabled) this.requireOtherAdmin(id)
    this.sockets.close((s) => s.userId === id)
    this.db.delete(schema.users).where(eq(schema.users.id, id)).run()
  }

  userByName(username: string) {
    return this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username.trim()))
      .get()
  }

  /** Records a login. */
  markLogin(userId: number) {
    this.db
      .update(schema.users)
      .set({ lastLoginAt: Date.now() })
      .where(eq(schema.users.id, userId))
      .run()
  }

  // ---- identity providers

  /**
   * The user for someone a provider has authenticated, or `undefined` if they may not
   * come in. A user already linked to `subject` is found; otherwise one is matched by
   * name or made, if the provider allows it.
   */
  resolveExternal(login: ExternalLogin) {
    const now = Date.now()
    const link = this.db
      .select()
      .from(schema.identities)
      .where(
        and(
          eq(schema.identities.provider, login.provider),
          eq(schema.identities.subject, login.subject),
        ),
      )
      .get()
    let user = link && this.user(link.userId)
    if (!user && !link) {
      const existing = login.matchUsername ? this.userByName(login.username) : undefined
      // a user already tied to a different identity at this provider is not handed over
      const taken =
        existing &&
        this.db
          .select({ id: schema.identities.id })
          .from(schema.identities)
          .where(
            and(
              eq(schema.identities.userId, existing.id),
              eq(schema.identities.provider, login.provider),
            ),
          )
          .get()
      if (existing && !taken) user = existing
      else if (!existing && login.create)
        user = this.insertUser(this.freeName(login.username), login.create.role)
      if (user) {
        this.db
          .insert(schema.identities)
          .values({
            provider: login.provider,
            subject: login.subject,
            userId: user.id,
            createdAt: now,
          })
          .run()
      }
    }
    if (!user) return
    if (link) {
      this.db
        .update(schema.identities)
        .set({ lastLoginAt: now })
        .where(eq(schema.identities.id, link.id))
        .run()
    }
    if (login.role && user.role !== login.role && isRole(login.role)) {
      try {
        this.updateUser(user.id, { role: login.role })
        user = this.user(user.id)!
      } catch (error) {
        // e.g. the provider would demote the last administrator
        this.ctx.logger.warn(
          'could not set the role of %s: %s',
          user.username,
          (error as Error).message,
        )
      }
    }
    return user
  }

  /** `username`, or that with a number added if someone has it. */
  private freeName(username: string) {
    const base = checkUsername(username)
    let name = base
    for (let n = 2; this.userByName(name); n++) name = `${base}-${n}`
    return name
  }

  /** Starts a session for a user who has authenticated, and sends the browser on. */
  signIn(req: Request, res: Response, user: schema.User, next: string) {
    if (user.disabled) return this.loginFailed(res, 'this account is switched off', next)
    this.markLogin(user.id)
    this.startSession(req, res, user.id)
    redirect(res, next)
  }

  /** Sends the browser back to the login page with a message. */
  loginFailed(res: Response, error: string, next: string) {
    redirect(res, `/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`)
  }

  private startSession(req: Request, res: Response, userId: number) {
    const value = this.createSession(userId, {
      address: this.clientAddress(req),
      userAgent: req.headers.get('user-agent') ?? undefined,
    })
    const secure =
      this.config.trustProxy && req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : ''
    res.headers.append(
      'set-cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.config.sessionDays * 86_400}${secure}`,
    )
    return value
  }

  /** The caller's address; behind a trusted proxy, the one it reports. */
  clientAddress(req: Request) {
    if (this.config.trustProxy) {
      const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      if (forwarded) return forwarded
    }
    return req._req.socket.remoteAddress ?? ''
  }

  /** This Magpie's address as the caller sees it, e.g. `https://magpie.home`. */
  origin(req: Request) {
    const proxied = this.config.trustProxy
    const protocol =
      (proxied && req.headers.get('x-forwarded-proto')) ||
      ((req._req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http')
    const host = (proxied && req.headers.get('x-forwarded-host')) || req.headers.get('host')
    return `${protocol}://${host}`
  }

  /**
   * Signs in a request that proves who it is without a form, through a provider that
   * can (a trusted proxy's header). Starts a session, so the next request needs no proof.
   */
  autoLogin(req: Request, res: Response): Identity | undefined {
    for (const provider of this.providers.list()) {
      const login = provider.authenticate?.(req)
      const user = login && this.resolveExternal(login)
      if (!user || user.disabled) continue
      this.markLogin(user.id)
      const value = this.startSession(req, res, user.id)
      return this.session(value)
    }
  }

  private requireUser(id: number) {
    const user = this.user(id)
    if (!user) throw new Error('no such user')
    return user
  }

  private requireOtherAdmin(id: number) {
    const other = this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'admin'),
          eq(schema.users.disabled, false),
          ne(schema.users.id, id),
        ),
      )
      .get()
    if (!other) throw new Error('there must be at least one active administrator')
  }

  // ---- sessions

  createSession(userId: number, meta: { address?: string; userAgent?: string } = {}) {
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
        lastSeenAt: now,
        address: meta.address?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 200) ?? null,
      })
      .run()
    return value
  }

  /** The user of a live session, extending it when it is past half its life. */
  session(value: string): Extract<Identity, { type: 'session' }> | undefined {
    const id = sha256(value)
    const session = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    const now = Date.now()
    if (!session || session.expiresAt < now) return
    const user = this.user(session.userId)
    if (!user || user.disabled) return
    const lifetime = this.config.sessionDays * DAY
    const extend = session.expiresAt - now < lifetime / 2
    if (extend || now - (session.lastSeenAt ?? 0) > TOUCH_INTERVAL) {
      this.db
        .update(schema.sessions)
        .set({ lastSeenAt: now, ...(extend && { expiresAt: now + lifetime }) })
        .where(eq(schema.sessions.id, id))
        .run()
    }
    return { type: 'session', user, sessionId: id }
  }

  endSession(value: string) {
    this.revoke(sha256(value))
  }

  /** A user's live sessions, newest first. `current` is the id of the one asking. */
  sessions(userId: number, current?: string): SessionInfo[] {
    return this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .orderBy(desc(schema.sessions.createdAt))
      .all()
      .filter((s) => s.expiresAt > Date.now())
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        address: s.address,
        userAgent: s.userAgent,
        current: s.id === current,
      }))
  }

  /** Ends one of a user's sessions, and the console sockets that used it. */
  revokeSession(userId: number, id: string) {
    const owned = this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, userId)))
      .get()
    if (owned) this.revoke(id)
  }

  /** Ends a user's sessions, except `keep` (a session id). */
  endSessions(userId: number, keep?: string) {
    for (const s of this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .all()) {
      if (s.id !== keep) this.revoke(s.id)
    }
  }

  private revoke(id: string) {
    this.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run()
    this.sockets.close((s) => s.sessionId === id)
  }

  // ---- API keys

  /** Creates a key. The returned `key` is shown once; only its hash is stored. */
  createApiKey(name: string, options: { role?: Role; userId?: number } = {}) {
    const role = options.role ?? 'manager'
    if (!(KEY_ROLES as readonly string[]).includes(role))
      throw new Error('an API key can be a viewer or a manager')
    const key = token(24)
    const row = this.db
      .insert(schema.apiKeys)
      .values({
        name: name.trim() || 'API key',
        keyHash: sha256(key),
        prefix: key.slice(0, 6),
        role,
        userId: options.userId ?? null,
        createdAt: Date.now(),
      })
      .returning()
      .get()
    return { key, row }
  }

  apiKeys(): ApiKeyInfo[] {
    const owners = new Map(
      this.db
        .select()
        .from(schema.users)
        .all()
        .map((u) => [u.id, u.username]),
    )
    return this.db
      .select()
      .from(schema.apiKeys)
      .orderBy(desc(schema.apiKeys.createdAt))
      .all()
      .map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        role: isRole(k.role) ? k.role : 'viewer',
        owner: k.userId ? (owners.get(k.userId) ?? null) : null,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }))
  }

  revokeApiKey(id: number) {
    this.db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id)).run()
  }

  /** The key's identity: its role, held down to its owner's if it has one. */
  checkApiKey(value: string): Extract<Identity, { type: 'api-key' }> | undefined {
    const key = this.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, sha256(value)))
      .get()
    if (!key || !isRole(key.role)) return
    let role: Role = key.role
    if (key.userId !== null) {
      const owner = this.user(key.userId)
      if (!owner || owner.disabled || !isRole(owner.role)) return
      // a key never outranks the person who made it
      if (!roleAtMost(key.role, owner.role)) role = owner.role
    }
    const now = Date.now()
    if (now - (key.lastUsedAt ?? 0) > TOUCH_INTERVAL) {
      this.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(schema.apiKeys.id, key.id))
        .run()
    }
    return { type: 'api-key', key, role }
  }

  // ---- requests

  /** Who made a request that passed the guard. */
  identity(req: Request) {
    return this.identities.get(req._req)
  }

  /** @internal Set by the guard. */
  remember(req: Request, identity: Identity) {
    this.identities.set(req._req, identity)
  }

  authenticate(req: Request): Identity | undefined {
    const cookie = readCookie(req.headers.get('cookie'), COOKIE)
    const session = cookie && this.session(cookie)
    if (session) return session
    if (!req.path.startsWith('/api/')) return
    const key = req.headers.get('x-api-key') ?? req.query.get('apikey')
    return (key && this.checkApiKey(key)) || undefined
  }
}

function toInfo(u: schema.User, methods: string[]): UserInfo {
  return {
    methods,
    id: u.id,
    username: u.username,
    role: isRole(u.role) ? u.role : 'viewer',
    disabled: u.disabled,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  }
}

/** SQLite's constraint error, which Drizzle wraps in a "Failed query" error. */
function isUniqueViolation(error: unknown) {
  for (let e = error; e instanceof Error; e = e.cause) if (/UNIQUE/i.test(e.message)) return true
  return false
}

function checkUsername(username: string) {
  username = username.trim()
  if (!username) throw new Error('enter a username')
  if (username.length > 64) throw new Error('the username is too long')
  return username
}

export default AuthService
