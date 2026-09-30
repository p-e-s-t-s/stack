// @magpiejs/media-servers: after an import, tells Plex, Jellyfin or Emby which files changed
// so the library updates without a full scan. Provider plugins register a server; this plugin
// maps paths, gathers changes for a few seconds, and sends each batch as a retrying job.
// Best effort: batches waiting in memory are lost on a restart, and a server that is down
// never affects the import.

import type {} from '@magpiejs/import'
import type { MediaChange } from '@magpiejs/import'
import type {} from '@magpiejs/jobs'
import type { TestResult } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import console_ from './console'
import type { ServerOptions } from './config'
import { mapPath } from './paths'

export * from './paths'

declare module 'cordis' {
  interface Context {
    mediaServers: MediaServersService
  }
  interface Events {
    'mediaservers/changed'(): void
  }
}

/** A file to tell the server about, at the path the server sees. */
export interface ChangedPath {
  path: string
  change: 'added' | 'removed'
}

export interface ServerLibrary {
  name: string
  /** Folders the server watches for this library, in the server's paths. */
  paths: string[]
}

export interface MediaServerProvider {
  id: string
  /** Checks the connection and credentials; never starts a scan. */
  test(): Promise<TestResult>
  libraries(signal?: AbortSignal): Promise<ServerLibrary[]>
  /**
   * Asks the server to look at these paths. Resolving means the server accepted the request,
   * not that it finished scanning.
   */
  refresh(paths: ChangedPath[], options?: { signal?: AbortSignal }): Promise<void>
}

export interface ServerOptionsWithName extends ServerOptions {
  name: string
}

export interface ServerStatus {
  id: string
  name: string
  /** Changes waiting for the debounce to end. */
  pending: number
  lastAcceptedAt?: number
  lastError?: string
  /** Why the last change was left out, e.g. no path mapping covers it. */
  lastSkipped?: string
}

interface Entry {
  provider: MediaServerProvider
  options: ServerOptionsWithName
  pending: Map<string, ChangedPath>
  firstAt?: number
  cancel?: () => void
  status: Omit<ServerStatus, 'id' | 'name' | 'pending'>
}

interface RefreshPayload {
  serverId: string
  paths: ChangedPath[]
}

export interface Config {
  /** The longest a batch waits while imports keep arriving. */
  maxWaitMs: number
}

export class MediaServersService extends Service {
  static inject = ['jobs', 'timer']

  config: Config
  now = () => Date.now()
  private servers = new Map<string, Entry>()
  private chains = new Map<string, Promise<unknown>>()

  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'mediaServers')
    this.config = { maxWaitMs: 60_000, ...config }
  }

  [Service.init]() {
    this.ctx.jobs.define('mediaservers.refresh', (payload: RefreshPayload, { signal }) =>
      this.send(payload, signal),
    )
    this.ctx.on('media/changed', (change) => this.onChanged(change))
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  /** Adds a server for the lifetime of the calling plugin. */
  register(provider: MediaServerProvider, options: ServerOptionsWithName) {
    return this.ctx.effect(() => {
      if (this.servers.has(provider.id))
        throw new Error(`media server ${provider.id} is already registered`)
      const entry: Entry = { provider, options, pending: new Map(), status: {} }
      this.servers.set(provider.id, entry)
      this.ctx.emit('mediaservers/changed')
      return () => {
        entry.cancel?.()
        this.servers.delete(provider.id)
        this.ctx.emit('mediaservers/changed')
      }
    }, `mediaServers.register(${options.name})`)
  }

  list(): ServerStatus[] {
    return [...this.servers.entries()].map(([id, e]) => ({
      id,
      name: e.options.name,
      pending: e.pending.size,
      ...e.status,
    }))
  }

  // ---- gathering changes

  private onChanged(change: MediaChange) {
    const changes: ChangedPath[] = [
      ...change.added.map((path) => ({ path, change: 'added' as const })),
      ...change.removed.map((path) => ({ path, change: 'removed' as const })),
    ]
    for (const [id, entry] of this.servers) {
      const { kinds, mappings } = entry.options
      if (kinds.length && !kinds.includes(change.item.kind)) continue
      for (const { path, change: kind } of changes) {
        const mapped = mapPath(path, mappings)
        if (mapped === undefined) {
          entry.status.lastSkipped = `no path mapping covers ${path}`
          continue
        }
        // the last change to a path wins
        entry.pending.set(mapped, { path: mapped, change: kind })
      }
      if (entry.pending.size) this.schedule(id, entry)
    }
    this.ctx.emit('mediaservers/changed')
  }

  /** Waits for the debounce, but never past the maximum wait while imports keep arriving. */
  private schedule(id: string, entry: Entry) {
    const now = this.now()
    entry.firstAt ??= now
    const wait = Math.min(entry.options.debounceMs, entry.firstAt + this.config.maxWaitMs - now)
    entry.cancel?.()
    if (wait <= 0) return void this.flush(id)
    entry.cancel = this.ctx.setTimeout(() => this.flush(id), wait)
  }

  /** Queues what has gathered for a server (or every server) now. */
  flush(id?: string) {
    for (const [serverId, entry] of this.servers) {
      if (id && id !== serverId) continue
      entry.cancel?.()
      entry.cancel = undefined
      entry.firstAt = undefined
      if (!entry.pending.size) continue
      // the batch is fixed here; later changes start the next one
      const paths = [...entry.pending.values()]
      entry.pending.clear()
      this.ctx.jobs.enqueue('mediaservers.refresh', { serverId, paths } satisfies RefreshPayload)
    }
    this.ctx.emit('mediaservers/changed')
  }

  // ---- sending

  private send({ serverId, paths }: RefreshPayload, signal: AbortSignal) {
    const entry = this.servers.get(serverId)
    // removed or disabled since it was queued; the next import tells the server anyway
    if (!entry) return
    return this.serialized(serverId, async () => {
      try {
        await entry.provider.refresh(paths, { signal })
        entry.status.lastAcceptedAt = this.now()
        entry.status.lastError = undefined
      } catch (error) {
        entry.status.lastError = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        this.ctx.emit('mediaservers/changed')
      }
    })
  }

  /** One request at a time per server. */
  private serialized<T>(id: string, task: () => Promise<T>) {
    const run = (this.chains.get(id) ?? Promise.resolve()).then(task, task)
    const tail = run.catch(() => {})
    this.chains.set(id, tail)
    void tail.then(() => this.chains.get(id) === tail && this.chains.delete(id))
    return run
  }

  // ---- checks from the settings page

  /** Checks the connection and lists what the server watches. Never starts a scan. */
  async test(id: string): Promise<TestResult> {
    const entry = this.servers.get(id)
    if (!entry) return { ok: false, message: 'not running; check that it is enabled' }
    try {
      const result = await entry.provider.test()
      if (!result.ok) return result
      const libraries = await entry.provider.libraries()
      return {
        ok: true,
        message: libraries.length
          ? `Connected. Libraries: ${libraries.map((l) => `${l.name} (${l.paths.join(', ')})`).join('; ')}`
          : 'Connected, but the server has no libraries',
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Asks the server to look at one path right now, for checking a setup end to end. */
  async testRefresh(id: string, path: string): Promise<TestResult> {
    const entry = this.servers.get(id)
    if (!entry) return { ok: false, message: 'not running; check that it is enabled' }
    const mapped = mapPath(path.trim(), entry.options.mappings)
    if (!path.trim()) return { ok: false, message: 'enter a folder in your library' }
    if (mapped === undefined) return { ok: false, message: `no path mapping covers ${path}` }
    try {
      await entry.provider.refresh([{ path: mapped, change: 'added' }])
      return { ok: true, message: `The server accepted a scan request for ${mapped}` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}

export default MediaServersService
