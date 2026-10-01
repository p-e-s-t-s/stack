// @magpiejs/list-plex: your Plex cloud watchlist. Needs your Plex token.
// Items carry TMDB/IMDb/TVDB ids, so titles resolve without searching by name.

import type {} from '@cordisjs/plugin-http'
import { type ListConfig, listConfig, listIdOf, settingsOf } from '@magpiejs/import-lists/config'
import type { ListEntry } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'list-plex'
export const inject = ['http', 'importLists']

export interface Config extends ListConfig {
  token: string
}

export const Config: z<Config> = z.object({
  token: z.string().role('secret').required().description('Your Plex token.'),
  ...listConfig,
  name: z.string().default('Plex watchlist').description('Name shown in Magpie.'),
})

const PAGE = 100

interface PlexItem {
  type?: string
  title?: string
  year?: number
  Guid?: { id: string }[]
}

export function entryOf(item: PlexItem): ListEntry | undefined {
  const kind = item.type === 'movie' ? 'movie' : item.type === 'show' ? 'series' : undefined
  if (!kind || !item.title) return undefined
  const ids: ListEntry['ids'] = {}
  for (const { id } of item.Guid ?? []) {
    const match = /^(tmdb|imdb|tvdb):\/\/(\S+)$/.exec(id)
    if (match) ids[match[1] as 'tmdb' | 'imdb' | 'tvdb'] = match[2]!
  }
  return { kind, title: item.title, year: item.year, ids }
}

export function apply(ctx: Context, config: Config) {
  const page = (start: number) =>
    ctx.http.get<{ MediaContainer?: { totalSize?: number; Metadata?: PlexItem[] } }>(
      'https://discover.provider.plex.tv/library/sections/watchlist/all',
      {
        params: {
          includeGuids: 1,
          'X-Plex-Container-Start': start,
          'X-Plex-Container-Size': PAGE,
        },
        headers: { Accept: 'application/json', 'X-Plex-Token': config.token },
        timeout: 15_000,
      },
    )
  ctx.importLists.register(
    {
      id: listIdOf(ctx, 'plex', config.name),
      kinds: ['movie', 'series'],
      async fetch() {
        const entries: ListEntry[] = []
        for (let start = 0; start < 20_000; start += PAGE) {
          const { MediaContainer: container } = await page(start)
          for (const item of container?.Metadata ?? []) {
            const entry = entryOf(item)
            if (entry) entries.push(entry)
          }
          if (start + PAGE >= (container?.totalSize ?? 0)) break
        }
        return entries
      },
      async test() {
        try {
          const { MediaContainer: container } = await page(0)
          return { ok: true, message: `Found the watchlist (${container?.totalSize ?? 0} titles)` }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    { name: config.name, settings: settingsOf(config) },
  )
}
