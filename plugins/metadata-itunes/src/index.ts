// @magpiejs/metadata-itunes: podcast search from the iTunes Search API. It needs no key; the
// podcasts plugin reads each podcast's own feed for its episodes.

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/metadata'
import type {} from '@magpiejs/podcasts'
import type { MetadataProvider, MetadataSearchResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'metadata-itunes'
export const inject = ['http', 'metadata']

export interface Config {
  country: string
  baseUrl: string
}

export const Config: z<Config> = z.object({
  country: z
    .string()
    .default('US')
    .description('Two-letter store country to search, e.g. US or GB.'),
  baseUrl: z.string().default('https://itunes.apple.com').hidden(),
})

interface ItunesPodcast {
  collectionId: number
  collectionName: string
  artistName?: string
  feedUrl?: string
  artworkUrl600?: string
  artworkUrl100?: string
  releaseDate?: string
  primaryGenreName?: string
}

export function apply(ctx: Context, config: Config) {
  const provider: MetadataProvider = {
    id: 'itunes',
    kinds: ['podcast'],
    async search(query) {
      const result = await ctx.http.get<{ results: ItunesPodcast[] }>(`${config.baseUrl}/search`, {
        params: {
          media: 'podcast',
          entity: 'podcast',
          term: query.term,
          country: config.country,
          limit: 25,
        },
        responseType: 'json',
        timeout: 15_000,
      })
      // podcasts without a public feed can't be followed
      return result.results
        .filter((p) => p.feedUrl)
        .map((p): MetadataSearchResult => ({
          kind: 'podcast',
          title: p.collectionName,
          author: p.artistName,
          posterUrl: p.artworkUrl600 ?? p.artworkUrl100,
          ids: { itunes: String(p.collectionId) },
          feedUrl: p.feedUrl,
          overview: p.primaryGenreName,
        }))
    },
  }
  ctx.metadata.register(provider)
}
