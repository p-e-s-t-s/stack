import Server from '@cordisjs/plugin-server'
import AuthService from '@magpiejs/auth'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import * as AuthProxy from '../src'
import { parseRange } from '../src'

let ctx: Context
let base: string
const LOCAL = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

async function start(config: Partial<AuthProxy.Config> = {}) {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(AuthService)
  await ctx.plugin(AuthProxy, {
    trustedProxies: LOCAL,
    userHeader: 'Remote-User',
    groupsHeader: 'Remote-Groups',
    adminGroups: ['admins'],
    managerGroups: ['family'],
    defaultRole: 'viewer',
    autoCreate: true,
    syncRoles: true,
    matchUsername: false,
    ...config,
  })
  ctx.server.get('/', async (_req, res) => void res.text('console'))
  base = ctx.server.baseUrl
}
beforeEach(() => () => void ctx?.server._http.close())

const visit = (headers: Record<string, string>) =>
  fetch(base + '/', { headers: { accept: 'text/html', ...headers }, redirect: 'manual' })

describe('proxy login', () => {
  it('signs in whoever the trusted proxy names, and makes them a user', async () => {
    await start()
    const res = await visit({ 'remote-user': 'amy' })
    expect(await res.text()).toBe('console')
    expect(ctx.auth.users()).toEqual([
      expect.objectContaining({ username: 'amy', role: 'viewer', methods: ['proxy'] }),
    ])
    // a second visit by the same person is the same user
    await visit({ 'remote-user': 'amy' })
    expect(ctx.auth.users()).toHaveLength(1)
  })

  it('believes nothing from a connection that is not from a trusted proxy', async () => {
    await start({ trustedProxies: ['10.1.2.3', '192.168.0.0/16'] })
    const res = await visit({ 'remote-user': 'mallory', 'remote-groups': 'admins' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/^\/login/)
    expect(ctx.auth.users()).toEqual([])
  })

  it('trusts no one when no proxy is listed', async () => {
    await start({ trustedProxies: [] })
    expect((await visit({ 'remote-user': 'amy' })).status).toBe(303)
    expect(ctx.auth.users()).toEqual([])
  })

  it('turns groups into roles, and lets the proxy change them later', async () => {
    await start()
    await visit({ 'remote-user': 'boss', 'remote-groups': 'staff, admins' })
    await visit({ 'remote-user': 'kim', 'remote-groups': 'family' })
    await visit({ 'remote-user': 'sam', 'remote-groups': 'guests' })
    const roles = () => Object.fromEntries(ctx.auth.users().map((u) => [u.username, u.role]))
    expect(roles()).toEqual({ boss: 'admin', kim: 'manager', sam: 'viewer' })

    await visit({ 'remote-user': 'sam', 'remote-groups': 'family' })
    expect(roles().sam).toBe('manager')
  })

  it('keeps the role it gave when roles are not synced', async () => {
    await start({ syncRoles: false })
    await visit({ 'remote-user': 'sam', 'remote-groups': 'family' })
    await visit({ 'remote-user': 'sam', 'remote-groups': 'admins' })
    expect(ctx.auth.users()[0]!.role).toBe('manager')
  })

  it('refuses people in no allowed group when the default role is none', async () => {
    await start({ defaultRole: 'none' })
    expect((await visit({ 'remote-user': 'sam', 'remote-groups': 'guests' })).status).toBe(303)
    expect((await visit({ 'remote-user': 'kim', 'remote-groups': 'family' })).status).toBe(200)
    expect(ctx.auth.users().map((u) => u.username)).toEqual(['kim'])
  })

  it('only makes users when it is allowed to', async () => {
    await start({ autoCreate: false })
    expect((await visit({ 'remote-user': 'amy' })).status).toBe(303)
    ctx.auth.createUser('amy', 'viewer')
    // a name alone does not hand over an existing user
    expect((await visit({ 'remote-user': 'amy' })).status).toBe(303)
  })

  it('can match existing users by name when told the names are trusted', async () => {
    await start({ autoCreate: false, matchUsername: true })
    const amy = ctx.auth.createUser('amy', 'viewer')
    expect((await visit({ 'remote-user': 'amy' })).status).toBe(200)
    expect(ctx.auth.userByName('amy')?.id).toBe(amy.id)
  })

  it('does not sign in a switched-off user', async () => {
    await start()
    await visit({ 'remote-user': 'amy' })
    ctx.auth.createUser('root', 'admin')
    ctx.auth.updateUser(ctx.auth.userByName('amy')!.id, { disabled: true })
    expect((await visit({ 'remote-user': 'amy' })).status).toBe(303)
  })
})

describe('trusted proxy ranges', () => {
  it('match addresses and ranges, including IPv4 over IPv6', () => {
    const range = parseRange('10.0.0.0/8')
    expect(range('10.20.30.40')).toBe(true)
    expect(range('::ffff:10.20.30.40')).toBe(true)
    expect(range('11.0.0.1')).toBe(false)
    expect(parseRange('172.18.0.5')('172.18.0.5')).toBe(true)
    expect(parseRange('172.18.0.5')('172.18.0.6')).toBe(false)
    expect(parseRange('0.0.0.0/0')('8.8.8.8')).toBe(true)
    expect(parseRange('::1')('::1')).toBe(true)
    expect(parseRange('::1')('::2')).toBe(false)
    expect(() => parseRange('10.0.0.0/40')).toThrow(/invalid/)
  })
})
