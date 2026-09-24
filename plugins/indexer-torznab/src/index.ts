// @magpiejs/indexer-torznab: one Torznab (torrents) or Newznab (usenet) indexer — for example
// one of Prowlarr's per-indexer URLs (`http://prowlarr:9696/1/api`).

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/indexers'
import type { IndexerProvider, ReleaseQuery } from '@magpiejs/types'
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
  movieCategories: number[]
  tvCategories: number[]
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
  movieCategories: z
    .array(z.natural())
    .default([2000])
    .description('Categories searched for movies.'),
  tvCategories: z.array(z.natural()).default([5000]).description('Categories searched for series.'),
  priority: z
    .natural()
    .default(25)
    .description('Lower is preferred when releases are otherwise equal.'),
  enableRss: z.boolean().default(true),
  enableAutomatic: z.boolean().default(true),
  enableInteractive: z.boolean().default(true),
})

export function apply(ctx: Context, config: Config) {
  // the loader entry id is stable across restarts, so health history survives
  const id = `torznab:${(ctx.fiber as { entry?: { id: string } }).entry?.id ?? config.name}`
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

  const provider: IndexerProvider = {
    id,
    protocol: config.protocol,

    capabilities,

    async search(q: ReleaseQuery) {
      const c = await capabilities()
      const cat = (q.kind === 'movie' ? config.movieCategories : config.tvCategories).join(',')
      const params: Record<string, string | number | undefined> = { cat, extended: 1, limit: 100 }
      const imdb = q.ids?.imdb?.replace(/^tt/, '')
      if (q.kind === 'movie' && c.searchParams.movie.length) {
        params.t = 'movie'
        if (imdb && c.movieIds.includes('imdbid')) params.imdbid = imdb
        if (q.ids?.tmdb && c.movieIds.includes('tmdbid')) params.tmdbid = q.ids.tmdb
        if (!params.imdbid && !params.tmdbid) params.q = q.term
      } else if (q.kind === 'series' && c.searchParams.tv.length) {
        params.t = 'tvsearch'
        if (q.ids?.tvdb && c.tvIds.includes('tvdbid')) params.tvdbid = q.ids.tvdb
        if (imdb && c.tvIds.includes('imdbid')) params.imdbid = imdb
        if (!params.tvdbid && !params.imdbid) params.q = q.term
        params.season = q.season
        params.ep = q.episode
      } else {
        params.t = 'search'
        params.q = q.term
      }
      return parseResults(await request(params), id, config.protocol)
    },

    async rss() {
      const cat = [...config.movieCategories, ...config.tvCategories].join(',')
      return parseResults(
        await request({ t: 'search', cat, extended: 1, limit: 100 }),
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
