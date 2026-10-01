// @magpiejs/auth-proxy: lets a reverse proxy that has already authenticated the user
// (Authelia, Authentik, oauth2-proxy, Cloudflare Access…) say who they are in a header.
//
// Anyone who can reach Magpie directly could send that header themselves, so it is read
// only on connections that come from one of `trustedProxies`. With none listed, nothing
// is trusted and this plugin does nothing.

import type {} from '@magpiejs/auth'
import { roleFromGroups, roleRulesSchema, type RoleRules } from '@magpiejs/auth/mapping'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'auth-proxy'
export const inject = ['auth']

export interface Config extends RoleRules {
  trustedProxies: string[]
  userHeader: string
  groupsHeader: string
  autoCreate: boolean
  syncRoles: boolean
  matchUsername: boolean
}

export const Config: z<Config> = z.object({
  trustedProxies: z
    .array(String)
    .default([])
    .description(
      'Addresses or ranges (10.0.0.5, 172.18.0.0/16) of the proxy that sets the headers. ' +
        'Connections from anywhere else are never trusted.',
    ),
  userHeader: z.string().default('Remote-User').description('Header holding the username.'),
  groupsHeader: z
    .string()
    .default('Remote-Groups')
    .description('Header holding the user’s groups, separated by commas. Empty to ignore groups.'),
  ...roleRulesSchema('viewer'),
  autoCreate: z.boolean().default(true).description('Make a user the first time someone arrives.'),
  syncRoles: z
    .boolean()
    .default(true)
    .description('Set the role from the groups on every login, not only the first.'),
  matchUsername: z
    .boolean()
    .default(false)
    .description(
      'Sign in as an existing Magpie user with the same name. Only turn on if the proxy ' +
        'only lets in people whose names you trust: it gives them that user’s access.',
    ),
})

export function apply(ctx: Context, config: Config) {
  const trusted = config.trustedProxies.map(parseRange)
  if (!trusted.length) ctx.logger.warn('no trustedProxies are set, so no proxy header is believed')
  const userHeader = config.userHeader.toLowerCase()
  const groupsHeader = config.groupsHeader.toLowerCase()

  ctx.effect(
    () =>
      ctx.auth.providers.register({
        id: 'proxy',
        label: 'Reverse proxy',
        authenticate(req) {
          const from = req._req.socket.remoteAddress
          const username = req.headers.get(userHeader)?.trim()
          if (!username || username.length > 64) return
          if (!from || !trusted.some((range) => range(from))) return
          const groups = groupsHeader
            ? (req.headers.get(groupsHeader) ?? '')
                .split(',')
                .map((g) => g.trim())
                .filter(Boolean)
            : []
          const role = roleFromGroups(groups, config)
          // a person the rules let in at no role is refused, even if they are known
          if (!role) return
          return {
            provider: 'proxy',
            subject: username,
            username,
            create: config.autoCreate ? { role } : undefined,
            role: config.syncRoles && groupsHeader ? role : undefined,
            matchUsername: config.matchUsername,
          }
        },
      }),
    'auth-proxy: identity provider',
  )
}

/** A test for an address against `10.0.0.5`, `10.0.0.0/8`, or an IPv6 address. */
export function parseRange(spec: string): (address: string) => boolean {
  const [base, bits] = spec.trim().split('/')
  const target = ipv4(base!)
  if (target === undefined) {
    // IPv6: exact addresses only
    const wanted = normalize(base!)
    return (address) => normalize(address) === wanted
  }
  const length = bits === undefined ? 32 : Number(bits)
  if (!Number.isInteger(length) || length < 0 || length > 32)
    throw new Error(`invalid trusted proxy range ${spec}`)
  const mask = length === 0 ? 0 : (~0 << (32 - length)) >>> 0
  return (address) => {
    const value = ipv4(address)
    return value !== undefined && (value & mask) >>> 0 === (target & mask) >>> 0
  }
}

/** `::ffff:10.0.0.5` is the IPv4 address `10.0.0.5` reached over an IPv6 socket. */
function normalize(address: string) {
  return address.replace(/^::ffff:/i, '').toLowerCase()
}

function ipv4(address: string) {
  const parts = normalize(address).split('.')
  if (parts.length !== 4) return
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return
    value = value * 256 + Number(part)
  }
  return value
}
