// @magpiejs/media-server-plex: asks Plex to scan the folders of imported files.
//
// Unverified against a live server (the API docs and older support articles differ):
// `GET /library/sections` lists libraries with their folders, and
// `GET /library/sections/{key}/refresh?path=<folder>` scans one folder of one library.
// Both take the token as `X-Plex-Token`. Plex answers 200 once it has queued the scan.
// Docs: https://developer.plex.tv/pms/ and
// https://support.plex.tv/articles/201638786-plex-media-server-url-commands/

import type {} from '@cordisjs/plugin-http'
import {
  mediaServerConfig,
  type MediaServerConfig,
  optionsOf,
} from '@magpiejs/media-servers/config'
import type { ChangedPath, MediaServerProvider, ServerLibrary } from '@magpiejs/media-servers'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'media-server-plex'
export const inject = ['http', 'mediaServers']

export interface Config extends MediaServerConfig {
  name: string
  url: string
  token: string
  libraries: string
}

export const Config: z<Config> = z.object({
  name: z.string().default('Plex').description('Name shown in Magpie.'),
  url: z.string().default('http://localhost:32400').description('Plex address.'),
  token: z
    .string()
    .role('secret')
    .default('')
    .description('A Plex token (see Plex support: "Finding an authentication token").'),
  libraries: z
    .string()
    .default('')
    .description('Only scan these libraries, by name, separated by commas. Empty means all.'),
  ...mediaServerConfig,
})

interface Section {
  key: string
  title: string
  Location?: { path: string }[]
}

const parent = (path: string) => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

/** True when `folder` is `root` or inside it (whole folders, either separator, any case). */
function within(folder: string, root: string) {
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean)
  const a = split(folder.toLowerCase())
  const b = split(root.toLowerCase())
  return b.every((part, i) => a[i] === part)
}

/**
 * The folders to scan and the library each belongs to: the longest library folder that
 * contains it. A path no selected library contains is left out and returned as `unmatched`.
 */
export function plan(paths: ChangedPath[], sections: Section[]) {
  const scans = new Map<string, { section: Section; folder: string }>()
  const unmatched: string[] = []
  for (const { path } of paths) {
    const folder = parent(path)
    let best: { section: Section; length: number } | undefined
    for (const section of sections)
      for (const { path: root } of section.Location ?? [])
        if (within(folder, root) && (!best || root.length > best.length))
          best = { section, length: root.length }
    if (best) scans.set(`${best.section.key}\n${folder}`, { section: best.section, folder })
    else unmatched.push(path)
  }
  return { scans: [...scans.values()], unmatched }
}

export function apply(ctx: Context, config: Config) {
  const base = new URL(config.url)
  if (base.username || base.password) throw new Error('put the token in its own field')
  const root = base.toString().replace(/\/+$/, '')
  const wanted = config.libraries
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
  const id = `plex:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`

  async function get(path: string, signal?: AbortSignal) {
    const response = await ctx.http(`${root}${path}`, {
      method: 'GET',
      headers: { 'X-Plex-Token': config.token, Accept: 'application/json' },
      validateStatus: () => true,
      timeout: 30_000,
      signal,
    } as never)
    if (response.status === 401) throw new Error('Plex refused the token')
    if (response.status >= 400) throw new Error(`Plex answered HTTP ${response.status}`)
    return response
  }

  async function sections(signal?: AbortSignal): Promise<Section[]> {
    const body = (await (await get('/library/sections', signal)).json()) as {
      MediaContainer?: { Directory?: Section[] }
    }
    const all = body.MediaContainer?.Directory ?? []
    return wanted.length ? all.filter((s) => wanted.includes(s.title.toLowerCase())) : all
  }

  const provider: MediaServerProvider = {
    id,
    async test() {
      await get('/identity')
      await sections()
      return { ok: true }
    },
    async libraries(signal) {
      return (await sections(signal)).map((s): ServerLibrary => ({
        name: s.title,
        paths: (s.Location ?? []).map((l) => l.path),
      }))
    },
    async refresh(paths, options) {
      const { scans, unmatched } = plan(paths, await sections(options?.signal))
      for (const { section, folder } of scans)
        await get(
          `/library/sections/${encodeURIComponent(section.key)}/refresh?path=${encodeURIComponent(folder)}`,
          options?.signal,
        )
      // a path no selected library covers will not be retried into existence, so name it
      if (unmatched.length && !scans.length)
        throw new Error(`no selected Plex library contains ${unmatched[0]}`)
    },
  }
  ctx.mediaServers.register(provider, { name: config.name, ...optionsOf(config) })
}
