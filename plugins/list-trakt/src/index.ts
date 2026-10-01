// @magpiejs/list-trakt: a Trakt watchlist or list. Needs a Trakt API app's client id; the
// watchlist and private lists also need an access token for that app. Tokens last about
// three months, after which the list reports an authorization error until a new one is set.
// Docs: https://trakt.docs.apiary.io/

import type {} from '@cordisjs/plugin-http'
import { type ListConfig, listConfig, listIdOf, settingsOf } from '@magpiejs/import-lists/config'
import type { ListEntry } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'list-trakt'
export const inject = ['http', 'importLists']

export interface Config extends ListConfig {
  clientId: string
  accessToken: string
  list: string
}

export const Config: z<Config> = z.object({
  clientId: z.string().role('secret').required().description('Client id of your Trakt API app.'),
  accessToken: z
    .string()
    .role('secret')
    .default('')
    .description('Access token; needed for the watchlist and private lists.'),
  list: z
    .string()
    .default('watchlist')
    .description('`watchlist`, or `username/list-slug` for a custom list.'),
  ...listConfig,
  name: z.string().default('Trakt').description('Name shown in Magpie.'),
})

const PAGE = 100

/** The API path for the `list` setting. */
export function pathOf(list: string) {
  const value = list.trim()
  if (value === 'watchlist') return '/sync/watchlist'
  const match = /^\/?([\w.-]+)\/(?:lists\/)?([\w.-]+)$/.exec(
    value.replace(/^https?:\/\/trakt\.tv\/users\//, ''),
  )
  if (!match) throw new Error('use `watchlist` or `username/list-slug`')
  const [, user, slug] = match
  return `/users/${user}/lists/${slug}/items`
}

interface TraktMedia {
  title?: string
  year?: number
  ids?: { tmdb?: number; imdb?: string; tvdb?: number }
}
interface TraktItem {
  type: string
  movie?: TraktMedia
  show?: TraktMedia
}

export function entryOf(item: TraktItem): ListEntry | undefined {
  const kind = item.type === 'movie' ? 'movie' : item.type === 'show' ? 'series' : undefined
  const media = kind === 'movie' ? item.movie : item.show
  if (!kind || !media?.title) return undefined
  const { tmdb, imdb, tvdb } = media.ids ?? {}
  return {
    kind,
    title: media.title,
    year: media.year,
    ids: {
      ...(tmdb && { tmdb: String(tmdb) }),
      ...(imdb && { imdb }),
      ...(tvdb && { tvdb: String(tvdb) }),
    },
  }
}

export function apply(ctx: Context, config: Config) {
  const path = pathOf(config.list)
  const page = (n: number) =>
    ctx.http.get<TraktItem[]>(`https://api.trakt.tv${path}`, {
      params: { page: n, limit: PAGE },
      headers: {
        'trakt-api-version': '2',
        'trakt-api-key': config.clientId,
        ...(config.accessToken && { Authorization: `Bearer ${config.accessToken}` }),
      },
      timeout: 15_000,
    })
  ctx.importLists.register(
    {
      id: listIdOf(ctx, 'trakt', config.name),
      kinds: ['movie', 'series'],
      async fetch() {
        const entries: ListEntry[] = []
        for (let n = 1; n <= 200; n++) {
          const items = await page(n)
          for (const item of items) {
            const entry = entryOf(item)
            if (entry) entries.push(entry)
          }
          if (items.length < PAGE) break
        }
        return entries
      },
      async test() {
        try {
          const items = await page(1)
          return { ok: true, message: `Found the list (${items.length} on the first page)` }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    { name: config.name, settings: settingsOf(config) },
  )
}
