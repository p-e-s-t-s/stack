import type { Context } from 'cordis'
import type { Role } from '../src'

/** The first account, an administrator with a password. */
export async function makeAdmin(ctx: Context, username = 'root', password = 'long enough') {
  const user = ctx.auth.createFirstAdmin(username)
  await ctx.auth.providers.password()!.reset(user.id, password)
  return user
}

/** A user who can log in with a password. */
export async function makeUser(
  ctx: Context,
  username: string,
  role: Role,
  password = 'long enough',
) {
  const user = ctx.auth.createUser(username, role)
  await ctx.auth.providers.password()!.reset(user.id, password)
  return user
}
