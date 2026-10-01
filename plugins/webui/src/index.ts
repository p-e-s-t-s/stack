// @magpiejs/webui: provides the `webui` service from @cordisjs/plugin-webui, but serves
// Magpie's own shell instead of the stock console (no stock pages; docs/PLAN.md §0).
// Pages, widgets and actions come from feature plugins through webui entries.
//
// Access control: the stock service sends every entry to every socket and runs any
// method a socket names. Here each entry declares the permission it needs (`access`), a
// policy (installed by @magpiejs/auth) says who is on a socket and what they may do, and
// this service only sends entries, deltas and RPC results the caller is allowed.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DeltaState, type Mutation, observe } from '@cordisjs/muon'
import NodeWebUI, { Client, Entry, type WebSocket } from '@cordisjs/plugin-webui'
import type { Permission } from '@magpiejs/types'
import type { Context } from 'cordis'
import { filterMutation, omitKeys } from './filter'

export { filterMutation, omitKeys } from './filter'

const appDir = fileURLToPath(new URL('../app', import.meta.url))
const distDir = fileURLToPath(new URL('../dist', import.meta.url))

/** What an entry's data and methods need. Entries without it are for administrators only. */
export interface EntryAccess {
  /** To receive the entry's data and its page. */
  view: Permission
  /** To call its methods, unless `methods` names one. Defaults to `view`. */
  call?: Permission
  /** Per-method permissions, e.g. read-only lookups next to editing actions. */
  methods?: Record<string, Permission>
  /**
   * Top-level keys of the entry's data that need more than `view`, e.g. a settings list
   * on a page that otherwise shows the library. Callers without it never receive the key,
   * not in the first snapshot and not in later changes.
   */
  data?: Record<string, Permission>
}

declare module '@cordisjs/plugin-webui' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Entry {
    interface Files {
      access?: EntryAccess
    }
  }
}

/** Who may do what on a console socket. Set by the auth plugin. */
export interface AccessPolicy<Caller = unknown> {
  /** Who owns a socket, or `undefined` to refuse it. */
  identify(socket: WebSocket): Caller | undefined
  can(caller: Caller, permission: Permission): boolean
  /** Sent to the console as a `caller` message, e.g. to hide pages. */
  describe?(caller: Caller): unknown
}

declare module '@cordisjs/plugin-webui' {
  interface WebUI {
    /** Set by auth (and unset when it goes away); with none, every socket may do everything. */
    policy?: AccessPolicy
  }
}

/** Needed by entries that declare no access. */
export const DEFAULT_PERMISSION: Permission = 'system.admin'

/**
 * The stock Client sends every entry from its constructor, and `broadcast` goes through
 * `send`, so filtering here covers both the first snapshot and later changes.
 */
class MagpieClient extends Client {
  override send(payload: any) {
    const webui = this.ctx.webui as MagpieWebUI
    if (webui.policy) {
      if (payload?.type === 'entry:init') {
        const entries: Record<string, unknown> = {}
        for (const [id, value] of Object.entries<any>(payload.body.entries ?? {})) {
          // `null` removes an entry, which every client may be told
          if (value === null) entries[id] = value
          else if (webui.canView(this.socket, webui.entries[id]))
            entries[id] = webui.snapshotFor(this, webui.entries[id]!, value)
        }
        // nothing this client may see changed
        if (!Object.keys(entries).length && Object.keys(payload.body.entries ?? {}).length) return
        payload = { ...payload, body: { ...payload.body, entries } }
      } else if (payload?.type === 'entry:delta') {
        if (!webui.canView(this.socket, webui.entries[payload.body.id])) return
      }
    }
    super.send(payload)
  }
}

/**
 * An entry whose data has keys only some callers may see. Its changes are sent to each
 * client separately, with the hidden keys taken out and re-encoded for that client, because
 * muon deltas leave out whatever repeats the delta before and so cannot be edited in place.
 */
class MagpieEntry<T extends object = any> extends Entry<T> {
  override mutate(fn: (data: T) => void) {
    const webui = this.ctx.webui as MagpieWebUI
    if (!this.files.access?.data || !webui.policy) return super.mutate(fn)
    // the stock Entry keeps these private
    const state = this as unknown as { _disposed: boolean; _initialized: boolean }
    if (state._disposed || !this.data) return
    const mutation = observe(this.data, fn)
    if (!mutation || !state._initialized) return
    webui.sendMutation(this, mutation)
  }
}

export class MagpieWebUI extends NodeWebUI {
  static override Config = NodeWebUI.Config

  /** Set by auth (and unset when it goes away); with none, every socket may do everything. */
  override policy?: AccessPolicy
  /** @internal */
  callers = new WeakMap<object, unknown>()
  /** What each client has been sent of an entry with hidden keys, to encode its changes. */
  private views = new WeakMap<Client, Map<string, DeltaState>>()

  constructor(ctx: Context, config: NodeWebUI.Config) {
    super(ctx, config)
    if (!config.devMode && !existsSync(distDir + '/manifest.json')) {
      throw new Error(
        'web console is not built; run `npm run build -w @magpiejs/webui` or start with --dev',
      )
    }
    this.root = config.devMode ? appDir : distDir

    // refuse methods the caller may not call before the stock handler runs them
    const call = this.listeners['rpc:request']!
    this.listeners['rpc:request'] = function (this: Client, body) {
      const webui = this.ctx.webui as MagpieWebUI
      const { sn, entryId, method } = body ?? {}
      const entry = webui.entries[entryId]
      if (entry && !webui.mayCall(this, entry, method)) {
        this.send({
          type: 'rpc:response',
          body: { sn, ok: false, message: 'you are not allowed to do that' },
        })
        return
      }
      return call.call(this, body)
    }
  }

  override addEntry<T extends object = never>(files: Entry.Files, data?: T): Entry<T> {
    return new MagpieEntry<T>(this.ctx, files, data as T)
  }

  // only the shell's own route; everything else is registered by entries
  protected override shellPaths = ['/']

  protected override accept(socket: WebSocket) {
    const caller = this.policy?.identify(socket)
    if (this.policy && caller === undefined) {
      socket.close(4401, 'not logged in')
      return
    }
    this.callers.set(socket, caller)
    // the stock Client sends every entry as it is built; `send` below filters them
    const client = new MagpieClient(this.ctx, socket)
    if (this.policy?.describe) {
      client.send({ type: 'caller', body: this.policy.describe(caller!) })
    }
    socket.addEventListener('close', () => {
      delete this.clients[client.id]
      this.ctx.emit(this, 'webui/connection', client)
    })
    this.clients[client.id] = client
    this.ctx.emit(this, 'webui/connection', client)
  }

  /** Whether a socket's owner holds `permission` (always, with no policy). */
  allowed(socket: WebSocket, permission: Permission) {
    if (!this.policy) return true
    const caller = this.callers.get(socket)
    return caller !== undefined && this.policy.can(caller, permission)
  }

  canView(socket: WebSocket, entry: Entry | undefined) {
    return this.allowed(socket, entry?.files.access?.view ?? DEFAULT_PERMISSION)
  }

  mayCall(client: Client, entry: Entry, method: string) {
    const access = entry.files.access
    if (!access) return this.allowed(client.socket, DEFAULT_PERMISSION)
    const needed = access.methods?.[method] ?? access.call ?? access.view
    return this.allowed(client.socket, needed)
  }

  /** The keys of an entry's data this socket's owner may not see. */
  hiddenKeys(socket: WebSocket, entry: Entry) {
    const rules = entry.files.access?.data
    return new Set(
      Object.entries(rules ?? {})
        .filter(([, permission]) => !this.allowed(socket, permission))
        .map(([key]) => key),
    )
  }

  /** An entry as sent to one client: hidden keys left out, and its change cursor started. */
  snapshotFor(client: Client, entry: Entry, json: any) {
    if (!entry.files.access?.data) return json
    const state = new DeltaState()
    let views = this.views.get(client)
    if (!views) this.views.set(client, (views = new Map()))
    views.set(entry.id, state)
    return {
      ...json,
      data: omitKeys(json.data, this.hiddenKeys(client.socket, entry)),
      cursor: state.snapshot(),
    }
  }

  /** Sends a change to an entry's data to each client that may see any of it. */
  sendMutation(entry: Entry, mutation: Mutation) {
    for (const client of Object.values(this.clients)) {
      if (!this.canView(client.socket, entry)) continue
      const state = this.views.get(client)?.get(entry.id)
      if (!state) {
        // this client was never sent the entry in a form it can follow, so send it whole
        client.send({
          type: 'entry:init',
          body: { version: this.version, entries: { [entry.id]: entry.toJSON() } },
        })
        continue
      }
      const visible = filterMutation(mutation, this.hiddenKeys(client.socket, entry))
      if (visible)
        client.send({ type: 'entry:delta', body: { id: entry.id, ...state.dump(visible) } })
    }
  }

  override broadcast(type: string, body: any) {
    for (const client of Object.values(this.clients)) client.send({ type, body })
  }
}

export default MagpieWebUI
