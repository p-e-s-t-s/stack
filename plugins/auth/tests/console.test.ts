import Server from '@cordisjs/plugin-server'
import DatabaseService from '@magpiejs/database'
import { MagpieWebUI } from '@magpiejs/webui'
import { DeltaState, apply } from '@cordisjs/muon'
import { Context, Service } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import AuthService from '../src'

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
      },
    )
    const viewer = await connect(await login('vic'))
    const manager = await connect(await login('mia'))
    expect(await viewer.call(entry.id, 'look')).toMatchObject({ ok: true, value: 'seen' })
    expect(await viewer.call(entry.id, 'change')).toMatchObject({ ok: false })
    expect(calls).toEqual([])
    expect(await manager.call(entry.id, 'change')).toMatchObject({ ok: true, value: 'changed' })
    expect(calls).toEqual(['change'])
    viewer.ws.close()
    manager.ws.close()
  })

  it('tells the console who is logged in', async () => {
    await users()
    const viewer = await connect(await login('vic'))
    const caller = viewer.messages.find((m) => m.type === 'caller')
    expect(caller.body).toMatchObject({ username: 'vic', role: 'viewer' })
    expect(caller.body.permissions).toContain('library.read')
    expect(caller.body.permissions).not.toContain('library.write')
    viewer.ws.close()
  })

  it('keeps hidden keys from callers who may not see them, now and as the data changes', async () => {
    await users()
    const data: any = {
      queue: [{ id: 1, progress: 0 }],
      clients: [{ name: 'qbittorrent', host: 'internal' }],
      label: 'one',
    }
    const entry = ctx.webui.addEntry(
      { ...files, access: { view: 'library.read', data: { clients: 'settings.manage' } } },
      data,
    )
    const admin = await connect(await login('root'))
    const viewer = await connect(await login('vic'))

    // each browser rebuilds the data from what it is sent, as the console does
    const follow = (who: Awaited<ReturnType<typeof connect>>) => {
      const state = new DeltaState()
      let mirror: any
      let seen = 0
      return () => {
        for (const message of who.messages.slice(seen)) {
          if (message.type === 'entry:init' && message.body.entries[entry.id]) {
            const { data, cursor } = message.body.entries[entry.id]
            mirror = JSON.parse(JSON.stringify(data))
            state.restore(cursor)
          } else if (message.type === 'entry:delta' && message.body.id === entry.id) {
            const { id: _, ...delta } = message.body
            apply(mirror, state.load(delta))
          }
        }
        seen = who.messages.length
        return mirror
      }
    }
    const adminSees = follow(admin)
    const viewerSees = follow(viewer)
    expect(adminSees()).toEqual(data)
    expect(viewerSees()).toEqual({ queue: data.queue, label: 'one' })

    const changes: ((d: any) => void)[] = [
      (d) => void (d.label = 'two'),
      (d) => void (d.clients[0].host = 'elsewhere'),
      (d) => void d.clients.push({ name: 'tx', host: 'other' }),
      (d) => void d.queue.push({ id: 2, progress: 10 }),
      (d) => Object.assign(d, { clients: [], label: 'three' }),
      (d) => void (d.queue[0].progress = 75),
    ]
    for (const change of changes) {
      entry.mutate(change)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(adminSees()).toEqual(JSON.parse(JSON.stringify(data)))
      const { clients: _, ...visible } = JSON.parse(JSON.stringify(data))
      expect(viewerSees()).toEqual(visible)
    }
    // nothing the viewer was ever sent mentions a hidden key
    expect(JSON.stringify(viewer.messages)).not.toMatch(/clients|internal|elsewhere|qbittorrent/)
    admin.ws.close()
    viewer.ws.close()
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
