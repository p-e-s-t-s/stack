// @magpiejs/list-tmdb: a TMDB list (a v4 list id or its URL). Needs a v4 read access token
// for lists made on the current site; a v3 key reads older lists.
// Docs: https://developer.themoviedb.org/reference/list-details

import type {} from '@cordisjs/plugin-http'
import { type ListConfig, listConfig, listIdOf, settingsOf } from '@magpiejs/import-lists/config'
import type { ListEntry } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'list-tmdb'
export const inject = ['http', 'importLists']

export interface Config extends ListConfig {
  apiKey: string
  list: string
}

export const Config: z<Config> = z.object({
  apiKey: z
    .string()
    .role('secret')
    .required()
    .description('TMDB read access token (v4), or an API key (v3) for older lists.'),
  list: z.string().required().description('The list id, or its address on themoviedb.org.'),
  ...listConfig,
  name: z.string().default('TMDB list').description('Name shown in Magpie.'),
})

/** The numeric id from `12345` or `https://www.themoviedb.org/list/12345-name`. */
export function listIdFrom(value: string) {
  const match = /^\s*(\d+)\s*$/.exec(value) ?? /\/list\/(\d+)/.exec(value)
  if (!match) throw new Error('not a TMDB list id or address')
  return match[1]!
}

interface TmdbItem {
  id: number
  media_type?: string
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

/** One list item as an entry; people and unknown types are skipped. */
export function entryOf(item: TmdbItem): ListEntry | undefined {
  const kind =
    item.media_type === 'tv' ? 'series' : item.media_type === 'movie' ? 'movie' : undefined
  const title = item.title ?? item.name
  if (!kind || !title) return undefined
  const date = kind === 'movie' ? item.release_date : item.first_air_date
  const year = date ? Number(date.slice(0, 4)) || undefined : undefined
  return { kind, title, year, ids: { tmdb: String(item.id) } }
}

export function apply(ctx: Context, config: Config) {
  const id = listIdFrom(config.list)
  const bearer = config.apiKey.length > 40
  const page = (n: number) =>
    ctx.http.get<{ results?: TmdbItem[]; items?: TmdbItem[]; total_pages?: number }>(
      bearer
        ? `https://api.themoviedb.org/4/list/${id}`
        : `https://api.themoviedb.org/3/list/${id}`,
      {
        params: { page: n, ...(!bearer && { api_key: config.apiKey }) },
        headers: bearer ? { Authorization: `Bearer ${config.apiKey}` } : {},
        timeout: 15_000,
      },
    )
  ctx.importLists.register(
    {
      id: listIdOf(ctx, 'tmdb', config.name),
      kinds: ['movie', 'series'],
      async fetch() {
        const entries: ListEntry[] = []
        for (let n = 1; n <= 200; n++) {
          const body = await page(n)
          const items = body.results ?? body.items ?? []
          for (const item of items) {
            // v3 lists without a media type hold movies
            const entry = entryOf({ media_type: 'movie', ...item })
            if (entry) entries.push(entry)
          }
          if (n >= (body.total_pages ?? 1)) break
        }
        return entries
      },
      async test() {
        try {
          const body = await page(1)
          const count = (body.results ?? body.items ?? []).length
          return { ok: true, message: `Found the list (${count} on the first page)` }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    { name: config.name, settings: settingsOf(config) },
  )
}
