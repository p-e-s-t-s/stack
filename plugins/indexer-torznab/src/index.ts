// @magpiejs/indexer-torznab: one Torznab (torrents) or Newznab (usenet) indexer — for example
// one of Prowlarr's per-indexer URLs (`http://prowlarr:9696/1/api`).

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/indexers'
import type { IndexerProvider, NewznabMode, ReleaseQuery } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'
import { parseCaps, parseResults } from './xml'

export const name = 'indexer-torznab'
export const inject = ['http', 'indexers']

export interface Config {
  name: string
  url: string
  apiKey: string
  protocol: 'torrent' | 'usenet'
  /** Categories per kind of media; kinds not listed use their defaults. */
  categories: Record<string, number[]>
  /** Before per-kind categories: read as the movie and series categories. */
  movieCategories?: number[]
  tvCategories?: number[]
  priority: number
  enableRss: boolean
  enableAutomatic: boolean
  enableInteractive: boolean
}

export const Config: z<Config> = z.object({
  name: z.string().required().description('Name shown in Magpie.'),
  url: z
    .string()
    .required()
    .description("Torznab/Newznab API URL, e.g. Prowlarr's `http://prowlarr:9696/1/api`."),
  apiKey: z
    .string()
    .role('secret')
    .default('')
    .description("API key (Prowlarr's API key for Prowlarr URLs)."),
  protocol: z
    .union(['torrent', 'usenet'])
    .default('torrent')
    .description('Torznab is torrent, Newznab is usenet.'),
  categories: z
    .dict(z.array(z.natural()))
    .default({})
    .description(
      'Categories per kind, e.g. movie = 2000 and series = 5000. Kinds left out use their usual categories.',
    ),
  movieCategories: z.array(z.natural()).hidden(),
  tvCategories: z.array(z.natural()).hidden(),
  priority: z
    .natural()
    .default(25)
    .description('Lower is preferred when releases are otherwise equal.'),
  enableRss: z.boolean().default(true),
  enableAutomatic: z.boolean().default(true),
  enableInteractive: z.boolean().default(true),
})

/** Where each search mode's parameters are in the capabilities. */
const CAPS: Record<NewznabMode, string> = {
  search: 'search',
  movie: 'movie',
  tvsearch: 'tv',
  music: 'music',
  book: 'book',
}

export function apply(ctx: Context, config: Config) {
  // the entry id in magpie.yml is stable across restarts, so health history survives (the
  // full `entry.id` also has the include entry's id, which is not)
  const id = `torznab:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  let caps: ReturnType<typeof parseCaps> | undefined

  const request = async (params: Record<string, string | number | undefined>) => {
    const query = Object.fromEntries(
      Object.entries({ ...params, apikey: config.apiKey || undefined }).filter(
        ([, v]) => v !== undefined && v !== '',
      ),
    ) as Record<string, string>
    return ctx.http.get<string>(config.url, {
      params: query,
      responseType: 'text',
      timeout: 30_000,
    })
  }

  const capabilities = async () => (caps ??= parseCaps(await request({ t: 'caps' })))

  /** This indexer's categories for a kind, else the older movie/TV settings, else defaults. */
  const categoriesFor = (kind: string) =>
    config.categories?.[kind] ??
    (kind === 'movie'
      ? config.movieCategories
      : kind === 'series'
        ? config.tvCategories
        : undefined) ??
    ctx.indexers.searchTypeOf(kind as never).defaultCategories

  const provider: IndexerProvider = {
    id,
    protocol: config.protocol,

    capabilities,

    async search(q: ReleaseQuery) {
      const c = await capabilities()
      const type = ctx.indexers.searchTypeOf(q.kind)
      const params: Record<string, string | number | undefined> = {
        cat: categoriesFor(q.kind).join(',') || undefined,
        extended: 1,
        limit: 100,
      }
      const supported = c.searchParams[CAPS[type.mode]] ?? []
      if (type.mode !== 'search' && supported.length) {
        params.t = type.mode
        let specific = false
        for (const [idKind, param] of Object.entries(type.ids ?? {})) {
          let value = q.ids?.[idKind as keyof typeof q.ids]
          if (idKind === 'imdb') value = value?.replace(/^tt/, '')
          if (value && supported.includes(param!)) {
            params[param!] = value
            specific = true
          }
        }
        for (const [field, value] of Object.entries(q.fields ?? {})) {
          if (value && supported.includes(field)) {
            params[field] = value
            specific = true
          }
        }
        if (!specific) params.q = q.term
        if (type.mode === 'tvsearch') {
          params.season = q.season
          params.ep = q.episode
        }
      } else {
        params.t = 'search'
        params.q = q.term
      }
      return parseResults(await request(params), id, config.protocol)
    },

    async rss() {
      const cat = [...new Set(ctx.indexers.searchKinds().flatMap(([kind]) => categoriesFor(kind)))]
      return parseResults(
        await request({ t: 'search', cat: cat.join(',') || undefined, extended: 1, limit: 100 }),
        id,
        config.protocol,
      )
    },

    async test() {
      caps = undefined
      const c = await capabilities()
      return { ok: true, message: `${c.categories.length} categories` }
    },
  }

  ctx.indexers.register(provider, {
    name: config.name,
    priority: config.priority,
    enableRss: config.enableRss,
    enableAutomatic: config.enableAutomatic,
    enableInteractive: config.enableInteractive,
  })
}
