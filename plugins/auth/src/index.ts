// @magpiejs/auth: users with roles, sessions and API keys for the web console, its
// WebSocket and the API (docs/phase-3.md §4.5, docs/auth.md). This file is the service:
// accounts, sessions, keys and the permission check. http.ts guards the server and serves
// the login routes; policy.ts connects it to the web console.

import type { Request } from '@cordisjs/plugin-server'
import type { Drizzle } from '@magpiejs/database'
import { type Context, Service } from 'cordis'
import { and, desc, eq, lt, ne } from 'drizzle-orm'
import z from 'schemastery'
import console_ from './console'
import { installGuard, installRoutes, readCookie, COOKIE } from './http'
import { hashPassword, sha256, token, verifyPassword } from './password'
import { KEY_ROLES, type Permission, type Role, isRole, roleAtMost, roleCan } from './permissions'
import { installPolicy, SocketRegistry } from './policy'
import * as schema from './schema'

export * from './schema'
export * from './permissions'

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
const MIN_PASSWORD = 8
/** Writes of "last seen" and "last used" are skipped when the last one is this recent. */
const TOUCH_INTERVAL = 60_000

export class AuthService extends Service {
  static inject = ['database', 'server']

  db!: Drizzle<typeof schema>
  /** Who made each request, set by the guard. */
  private identities = new WeakMap<object, Identity>()
  /** Open console sockets, to close them when their user's access changes. */
  sockets = new SocketRegistry()

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
    return this.db.select().from(schema.users).orderBy(schema.users.username).all().map(toInfo)
  }

  user(id: number) {
    return this.db.select().from(schema.users).where(eq(schema.users.id, id)).get()
  }

  /** Makes the first account, an administrator. Fails once any account exists. */
  async setup(username: string, password: string) {
    username = checkUsername(username)
    checkPassword(password)
    const passwordHash = await hashPassword(password)
    // no await between the check and the insert, so two setups cannot both win
    if (this.hasUsers()) throw new Error('an account already exists; log in')
    return this.insertUser(username, passwordHash, 'admin')
  }

  async createUser(username: string, password: string, role: Role) {
    username = checkUsername(username)
    checkPassword(password)
    if (!isRole(role)) throw new Error('choose a role')
    return this.insertUser(username, await hashPassword(password), role)
  }

  private insertUser(username: string, passwordHash: string, role: Role) {
    try {
      return this.db
        .insert(schema.users)
        .values({ username, passwordHash, role, createdAt: Date.now() })
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

  /** An administrator sets a new password for someone, ending their sessions. */
  async resetPassword(id: number, next: string) {
    this.requireUser(id)
    checkPassword(next)
    this.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(schema.users.id, id))
      .run()
    this.endSessions(id)
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

  /** Records a login. */
  markLogin(userId: number) {
    this.db
      .update(schema.users)
      .set({ lastLoginAt: Date.now() })
      .where(eq(schema.users.id, userId))
      .run()
  }

  /** Changes your own password and ends your other sessions. */
  async changePassword(userId: number, current: string, next: string, keepSession?: string) {
    const user = this.user(userId)
    if (!user || !(await verifyPassword(current, user.passwordHash)))
      throw new Error('the current password is wrong')
    checkPassword(next)
    this.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(schema.users.id, userId))
      .run()
    this.endSessions(userId, keepSession)
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

function toInfo(u: schema.User): UserInfo {
  return {
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

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD)
    throw new Error(`the password needs at least ${MIN_PASSWORD} characters`)
}

export default AuthService
