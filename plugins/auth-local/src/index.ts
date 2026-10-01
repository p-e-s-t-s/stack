// @magpiejs/auth-local: logging in with a username and password. It makes the first
// account on first start, checks passwords at the login page, and keeps them (scrypt
// hashes) in its own table. Auth owns the users and their roles; this only proves who
// someone is, like any other identity provider.

import type {} from '@magpiejs/auth'
import { type LoginView } from '@magpiejs/auth'
import { FailureLimiter, escapeHtml, readForm, safeNext } from '@magpiejs/auth/web'
import type { Drizzle } from '@magpiejs/database'
import type { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import z from 'schemastery'
import { hashPassword, verifyPassword } from './password'
import * as schema from './schema'

export * from './schema'

export const name = 'auth-local'
export const inject = ['database', 'auth', 'server']

export interface Config {
  minPasswordLength: number
}

export const Config: z<Config> = z.object({
  minPasswordLength: z.natural().min(1).default(8).description('Shortest password allowed.'),
})

/** Compared against when a username is unknown, so a wrong name takes as long as a wrong password. */
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

export function apply(ctx: Context, config: Config = { minPasswordLength: 8 }) {
  const db: Drizzle<typeof schema> = ctx.database.register({
    namespace: 'authlocal',
    schema,
    migrations: new URL('../migrations', import.meta.url),
  })
  const addresses = new FailureLimiter()
  const usernames = new FailureLimiter()

  const checkPassword = (password: string) => {
    if (password.length < config.minPasswordLength)
      throw new Error(`the password needs at least ${config.minPasswordLength} characters`)
  }
  const credential = (userId: number) =>
    db.select().from(schema.credentials).where(eq(schema.credentials.userId, userId)).get()
  const store = (userId: number, passwordHash: string) =>
    db
      .insert(schema.credentials)
      .values({ userId, passwordHash, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.credentials.userId,
        set: { passwordHash, updatedAt: Date.now() },
      })
      .run()

  const field = (name: string, label: string, type = 'text', extra = '') =>
    `<label>${label} <input name="${name}" type="${type}" required ${extra}></label>`
  const next = (view: LoginView) =>
    `<input type="hidden" name="next" value="${escapeHtml(view.next)}">`

  ctx.effect(
    () =>
      ctx.auth.providers.register({
        id: 'local',
        label: 'Password',
        login: (view) =>
          `<form method="post" action="/auth/local/login">
  ${field('username', 'Username', 'text', 'autocomplete="username" autofocus')}
  ${field('password', 'Password', 'password', 'autocomplete="current-password"')}
  ${next(view)}
  <button type="submit">Log in</button>
</form>`,
        setup: (view) =>
          view.setup
            ? `<form method="post" action="/auth/local/setup">
  ${field('username', 'Username', 'text', 'autocomplete="username" autofocus')}
  ${field('password', 'Password', 'password', `autocomplete="new-password" minlength="${config.minPasswordLength}"`)}
  ${field('confirm', 'Repeat password', 'password', `autocomplete="new-password" minlength="${config.minPasswordLength}"`)}
  ${next(view)}
  <button type="submit">Create account</button>
</form>`
            : undefined,
        password: {
          has: (userId) => !!credential(userId),
          async change(userId, current, replacement) {
            const row = credential(userId)
            if (!row || !(await verifyPassword(current, row.passwordHash)))
              throw new Error('the current password is wrong')
            checkPassword(replacement)
            store(userId, await hashPassword(replacement))
          },
          async reset(userId, replacement) {
            checkPassword(replacement)
            store(userId, await hashPassword(replacement))
          },
        },
        knows: (userId) => !!credential(userId),
      }),
    'auth-local: password identity provider',
  )

  ctx.server.post('/auth/local/setup', async (req, res) => {
    const form = await readForm(req)
    const to = safeNext(form.get('next'))
    const password = form.get('password') ?? ''
    if (password !== form.get('confirm'))
      return ctx.auth.loginFailed(res, 'the passwords differ', to)
    try {
      checkPassword(password)
      const passwordHash = await hashPassword(password)
      // no await between making the user and their password, so there is no user without one
      const user = ctx.auth.createFirstAdmin(form.get('username') ?? '')
      store(user.id, passwordHash)
      ctx.logger.info('created the administrator login for %s', user.username)
      ctx.auth.signIn(req, res, user, to)
    } catch (error) {
      ctx.auth.loginFailed(res, (error as Error).message, to)
    }
  })

  ctx.server.post('/auth/local/login', async (req, res) => {
    const form = await readForm(req)
    const to = safeNext(form.get('next'))
    const username = form.get('username') ?? ''
    const address = ctx.auth.clientAddress(req)
    const name = username.trim().toLowerCase()
    if (addresses.blocked(address) || usernames.blocked(name))
      return ctx.auth.loginFailed(res, 'too many failed attempts; try again in a few minutes', to)
    const user = ctx.auth.userByName(username)
    const row = user && credential(user.id)
    const ok = await verifyPassword(form.get('password') ?? '', row?.passwordHash ?? DUMMY_HASH)
    if (!user || !row || !ok) {
      addresses.fail(address)
      usernames.fail(name)
      ctx.logger.warn('failed login for %s from %s', name, address)
      return ctx.auth.loginFailed(res, 'wrong username or password', to)
    }
    addresses.clear(address)
    usernames.clear(name)
    ctx.auth.signIn(req, res, user, to)
  })
}
