// @magpiejs/media-server-emby: tells Emby which files were added or removed.
//
// Unverified against a live server. The request shape is from dev.emby.media (LibraryService/postLibraryMediaUpdated).
// `POST /Library/Media/Updated` with `{ Updates: [{ Path, UpdateType }] }` where UpdateType is
// `Created` or `Deleted`, and `GET /Library/VirtualFolders` for the libraries and their folders.
// Auth: `X-Emby-Token: <key>`.
// Emby and Jellyfin share these endpoints but are kept as separate adapters, since their
// versions can diverge.

import type {} from '@cordisjs/plugin-http'
import {
  mediaServerConfig,
  type MediaServerConfig,
  optionsOf,
} from '@magpiejs/media-servers/config'
import {
  type ChangedPath,
  isInside,
  type MediaServerProvider,
  type ServerLibrary,
} from '@magpiejs/media-servers'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'media-server-emby'
export const inject = ['http', 'mediaServers']

export interface Config extends MediaServerConfig {
  name: string
  url: string
  apiKey: string
  libraries: string
}

export const Config: z<Config> = z.object({
  name: z.string().default('Emby').description('Name shown in Magpie.'),
  url: z
    .string()
    .default('http://localhost:8096/emby')
    .description('Emby address, including any base path behind a reverse proxy.'),
  apiKey: z.string().role('secret').default('').description('An API key (Dashboard → API Keys).'),
  libraries: z
    .string()
    .default('')
    .description(
      'Only tell the server about these libraries, by name, separated by commas. Empty means all.',
    ),
  ...mediaServerConfig,
})

interface VirtualFolder {
  Name: string
  Locations?: string[]
}

/** The body of one request. */
export function body(paths: ChangedPath[]) {
  return {
    Updates: paths.map(({ path, change }) => ({
      Path: path,
      UpdateType: change === 'removed' ? 'Deleted' : 'Created',
    })),
  }
}

export function apply(ctx: Context, config: Config) {
  const base = new URL(config.url)
  if (base.username || base.password) throw new Error('put the API key in its own field')
  const root = base.toString().replace(/\/+$/, '')
  const wanted = config.libraries
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
  const id = `emby:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`

  async function call(
    path: string,
    init: { method?: string; data?: string; signal?: AbortSignal } = {},
  ) {
    const response = await ctx.http(`${root}${path}`, {
      method: init.method ?? 'GET',
      data: init.data,
      headers: {
        'X-Emby-Token': config.apiKey,
        Accept: 'application/json',
        ...(init.data && { 'Content-Type': 'application/json' }),
      },
      validateStatus: () => true,
      timeout: 30_000,
      signal: init.signal,
    } as never)
    if (response.status === 401 || response.status === 403)
      throw new Error('Emby refused the API key')
    if (response.status >= 400) throw new Error(`Emby answered HTTP ${response.status}`)
    return response
  }

  async function folders(signal?: AbortSignal): Promise<VirtualFolder[]> {
    const all = (await (
      await call('/Library/VirtualFolders', { signal })
    ).json()) as VirtualFolder[]
    return wanted.length ? all.filter((f) => wanted.includes(f.Name.toLowerCase())) : all
  }

  const provider: MediaServerProvider = {
    id,
    async test() {
      await folders()
      return { ok: true }
    },
    async libraries(signal) {
      return (await folders(signal)).map((f): ServerLibrary => ({
        name: f.Name,
        paths: f.Locations ?? [],
      }))
    },
    async refresh(paths, options) {
      let send = paths
      // with a library limit, leave other libraries alone; without one the server decides
      if (wanted.length) {
        const roots = (await folders(options?.signal)).flatMap((f) => f.Locations ?? [])
        send = paths.filter(({ path }) => roots.some((r) => isInside(path, r)))
      }
      if (!send.length) return
      await call('/Library/Media/Updated', {
        method: 'POST',
        data: JSON.stringify(body(send)),
        signal: options?.signal,
      })
    },
  }
  ctx.mediaServers.register(provider, { name: config.name, ...optionsOf(config) })
}
