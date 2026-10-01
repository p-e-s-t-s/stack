// Auth's own endpoints under /api/v1: your account and sessions for everyone, and users
// and API keys for administrators. Per-user data lives here rather than in the console's
// shared entry data, and each handler is told who is calling.

import { ApiError } from '@magpiejs/api'
import type { Context } from 'cordis'
import type AuthService from './index'
import type { Identity } from './index'
import { PERMISSIONS, type Role } from './permissions'

/** A handler's own failures ("the username is taken") reach the caller as 400s. */
async function call<T>(fn: () => T | Promise<T>) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, error instanceof Error ? error.message : String(error))
  }
}

function id(value: string | undefined) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'invalid ID')
  return n
}

/** Your own account is for people who logged in; an API key has none. */
function session(identity: Identity) {
  if (identity.type !== 'session') throw new ApiError(403, 'log in to change your account')
  return identity
}

export default function routes(ctx: Context, auth: AuthService) {
  const account = ctx.api.as('account.self')
  const admin = ctx.api.as('users.manage')

  account.get('/account', ({ identity }) => {
    const { user, sessionId } = session(identity)
    return {
      username: user.username,
      role: user.role,
      permissions: [...PERMISSIONS[user.role as Role]],
      sessions: auth.sessions(user.id, sessionId),
      // whether a password here can be changed, for the account page to offer it
      password: !!auth.providers.password()?.has(user.id),
    }
  })
  account.put('/account/password', ({ identity, body }) => {
    const { user, sessionId } = session(identity)
    const passwords = auth.providers.password()
    if (!passwords?.has(user.id)) throw new ApiError(400, 'this account has no password here')
    return call(async () => {
      await passwords.change(user.id, body?.current ?? '', body?.next ?? '')
      auth.endSessions(user.id, sessionId)
    })
  })
  // ends your other sessions, keeping this one
  account.delete('/account/sessions', ({ identity }) => {
    const { user, sessionId } = session(identity)
    auth.endSessions(user.id, sessionId)
  })
  account.delete('/account/sessions/:id', ({ identity, params }) => {
    auth.revokeSession(session(identity).user.id, params.id!)
  })

  admin.get('/users', () => auth.users())
  admin.post('/users', ({ body }) =>
    call(async () => {
      const passwords = auth.providers.password()
      if (body?.password && !passwords) throw new Error('no identity provider keeps passwords')
      const user = auth.createUser(body?.username ?? '', body?.role)
      if (body?.password) {
        try {
          await passwords!.reset(user.id, body.password)
        } catch (error) {
          // no half-made user: without a password they could not log in
          auth.deleteUser(user.id)
          throw error
        }
      }
      return auth.users().find((u) => u.id === user.id)
    }),
  )
  admin.patch('/users/:id', ({ params, body }) =>
    call(() => auth.updateUser(id(params.id), { role: body?.role, disabled: body?.disabled })),
  )
  admin.delete('/users/:id', ({ identity, params }) =>
    call(() => auth.deleteUser(id(params.id), session(identity).user.id)),
  )
  admin.put('/users/:id/password', ({ params, body }) =>
    call(async () => {
      const passwords = auth.providers.password()
      if (!passwords) throw new Error('no identity provider keeps passwords')
      const userId = id(params.id)
      if (!auth.user(userId)) throw new Error('no such user')
      await passwords.reset(userId, body?.password ?? '')
      auth.endSessions(userId)
    }),
  )

  admin.get('/api-keys', () => auth.apiKeys())
  // the key itself is in this response only; afterwards just its hash is stored
  admin.post('/api-keys', ({ identity, body }) =>
    call(() => {
      const { key, row } = auth.createApiKey(body?.name ?? '', {
        role: body?.role,
        userId: session(identity).user.id,
      })
      return { key, id: row.id }
    }),
  )
  admin.delete('/api-keys/:id', ({ params }) => auth.revokeApiKey(id(params.id)))
}
