import Server from '@cordisjs/plugin-server'
import DatabaseService from '@magpiejs/database'
import { MagpieWebUI } from '@magpiejs/webui'
import { Context, Service } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import AuthService, { type Identity } from '../src'

/** The real access rules on a console that has no browser bundle to build. */
class TestWebUI extends MagpieWebUI {
  override getEntryFiles() {
    return []
  }
  override resolveManifestUrl() {
    return undefined
  }
  override async [Service.init]() {
    this.ctx.server.ws('/ws', async (_req, next) => this.accept((await next()) as never))
  }
}

let ctx: Context
let base: string
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(TestWebUI, { devMode: true, uiPath: '', selfUrl: '', apiPath: '/ws' })
  await ctx.plugin(AuthService)
  base = ctx.server.baseUrl
  return () => void ctx.server._http.close()
})

const files = { baseUrl: import.meta.url, manifest: '' }
const login = async (username: string) => {
  const res = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: 'long enough' }),
    redirect: 'manual',
  })
  return res.headers.get('set-cookie')!.split(';')[0]!
}

async function users() {
  await ctx.auth.setup('root', 'long enough')
  await ctx.auth.createUser('mia', 'long enough', 'manager')
  await ctx.auth.createUser('vic', 'long enough', 'viewer')
}

/** A console connection that collects what the server sends. */
async function connect(cookie: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', {
    headers: { cookie, origin: base },
  })
  const messages: any[] = []
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
  await new Promise((resolve, reject) => (ws.on('open', resolve), ws.on('error', reject)))
  await new Promise((resolve) => setTimeout(resolve, 50))
  let sn = 0
  const call = (entryId: string, method: string, ...args: unknown[]) =>
    new Promise<any>((resolve) => {
      const id = ++sn
      const listener = (data: Buffer) => {
        const message = JSON.parse(data.toString())
        if (message.type === 'rpc:response' && message.body.sn === id) {
          ws.off('message', listener)
          resolve(message.body)
        }
      }
      ws.on('message', listener)
      ws.send(JSON.stringify({ type: 'rpc:request', body: { sn: id, entryId, method, args } }))
    })
  const entryIds = () =>
    Object.keys(messages.find((m) => m.type === 'entry:init')?.body.entries ?? {})
  return { ws, messages, call, closed, entryIds }
}

describe('console access', () => {
  it('sends each person only the entries their role can view', async () => {
    await users()
    const library = ctx.webui.addEntry({ ...files, access: { view: 'library.read' } }, { n: 1 })
    const settings = ctx.webui.addEntry({ ...files, access: { view: 'settings.manage' } }, {})
    const bare = ctx.webui.addEntry(files, {})

    const admin = await connect(await login('root'))
    const viewer = await connect(await login('vic'))
    expect(admin.entryIds()).toEqual(expect.arrayContaining([library.id, settings.id, bare.id]))
    // an entry that declares nothing is for administrators; auth's own is for everyone
    const authEntry = admin
      .entryIds()
      .find((id) => ![library.id, settings.id, bare.id].includes(id))!
    expect(viewer.entryIds().sort()).toEqual([library.id, authEntry].sort())

    // later changes and new entries are filtered the same way
    viewer.messages.length = 0
    settings.mutate((d: any) => (d.changed = true))
    library.mutate((d: any) => (d.n = 2))
    ctx.webui.addEntry({ ...files, access: { view: 'system.admin' } }, {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    const types = viewer.messages.map((m) => [m.type, m.body.id])
    expect(types).toEqual([['entry:delta', library.id]])
    expect(viewer.messages).toHaveLength(1)
    admin.ws.close()
    viewer.ws.close()
  })

  it('checks the permission of each method', async () => {
    await users()
    const calls: string[] = []
    const entry = ctx.webui.addEntry(
      {
        ...files,
        access: { view: 'library.read', call: 'library.write', methods: { look: 'library.read' } },
      },
      {
        look: async () => 'seen',
        change: async () => (calls.push('change'), 'changed'),
        who: async () => ctx.webui.caller<Identity>()?.type,
      },
    )
    const viewer = await connect(await login('vic'))
    const manager = await connect(await login('mia'))
    expect(await viewer.call(entry.id, 'look')).toMatchObject({ ok: true, value: 'seen' })
    expect(await viewer.call(entry.id, 'change')).toMatchObject({ ok: false })
    expect(calls).toEqual([])
    expect(await manager.call(entry.id, 'change')).toMatchObject({ ok: true, value: 'changed' })
    expect(await manager.call(entry.id, 'who')).toMatchObject({ ok: true, value: 'session' })
    expect(calls).toEqual(['change'])
    viewer.ws.close()
    manager.ws.close()
  })

  it('tells the console who is logged in, and runs methods as them', async () => {
    await users()
    const viewer = await connect(await login('vic'))
    const caller = viewer.messages.find((m) => m.type === 'caller')
    expect(caller.body).toMatchObject({ username: 'vic', role: 'viewer' })
    expect(caller.body.permissions).toContain('library.read')
    expect(caller.body.permissions).not.toContain('library.write')

    // the auth plugin's own entry: everyone sees it, only some methods are theirs
    const entryId = viewer.entryIds()[0]!
    expect(await viewer.call(entryId, 'me')).toMatchObject({ ok: true, value: { username: 'vic' } })
    expect(await viewer.call(entryId, 'users')).toMatchObject({ ok: false })
    expect(await viewer.call(entryId, 'createApiKey', 'k', 'viewer')).toMatchObject({ ok: false })
    expect(ctx.auth.apiKeys()).toEqual([])
    const admin = await connect(await login('root'))
    const key = await admin.call(admin.entryIds()[0]!, 'createApiKey', 'k', 'viewer')
    expect(key.ok).toBe(true)
    expect(ctx.auth.apiKeys()[0]).toMatchObject({ owner: 'root', role: 'viewer' })
    viewer.ws.close()
    admin.ws.close()
  })

  it('closes a console when its session ends or its role changes', async () => {
    await users()
    const [, mia, vic] = ctx.auth.users().sort((a, b) => a.id - b.id)
    const manager = await connect(await login('mia'))
    ctx.auth.updateUser(mia!.id, { role: 'viewer' })
    expect(await manager.closed).toBe(4401)

    const cookie = await login('vic')
    const viewer = await connect(cookie)
    ctx.auth.endSessions(vic!.id)
    expect(await viewer.closed).toBe(4401)
  })
})
