// @magpiejs/metadata-tmdb: movie metadata from The Movie Database (themoviedb.org).

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/metadata'
import type {
  MetadataProvider,
  MetadataSearchResult,
  MovieMetadata,
  SearchQuery,
} from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'metadata-tmdb'
export const inject = ['http', 'metadata']

export interface Config {
  apiKey: string
  language: string
  baseUrl: string
}

export const Config: z<Config> = z.object({
  apiKey: z
    .string()
    .role('secret')
    .required()
    .description('TMDB API key (v3) or read access token (v4).'),
  language: z.string().default('en-US').description('Language for titles and overviews.'),
  baseUrl: z.string().default('https://api.themoviedb.org/3').hidden(),
})

const IMAGE = 'https://image.tmdb.org/t/p/'

interface TmdbMovie {
  id: number
  title: string
  original_title?: string
  original_language?: string
  release_date?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  runtime?: number | null
  genres?: { name: string }[]
  imdb_id?: string | null
  release_dates?: {
    results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[]
  }
  alternative_titles?: { titles: { title: string }[] }
}

/** Earliest date of the given TMDB release types (3 theatrical, 4 digital, 5 physical). */
function earliest(movie: TmdbMovie, types: number[]) {
  const dates = (movie.release_dates?.results ?? [])
    .flatMap((r) => r.release_dates)
    .filter((d) => types.includes(d.type))
    .map((d) => d.release_date.slice(0, 10))
    .sort()
  return dates[0]
}

function base(movie: TmdbMovie): MetadataSearchResult {
  const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : undefined
  return {
    kind: 'movie',
    title: movie.title,
    year: year || undefined,
    overview: movie.overview || undefined,
    posterUrl: movie.poster_path ? `${IMAGE}w500${movie.poster_path}` : undefined,
    ids: { tmdb: String(movie.id), ...(movie.imdb_id && { imdb: movie.imdb_id }) },
  }
}

export function apply(ctx: Context, config: Config) {
  const bearer = config.apiKey.length > 40
  const get = <T>(path: string, params: Record<string, string | number | undefined> = {}) =>
    ctx.http.get<T>(config.baseUrl + path, {
      params: Object.fromEntries(
        Object.entries({
          language: config.language,
          ...(!bearer && { api_key: config.apiKey }),
          ...params,
        }).filter(([, value]) => value !== undefined),
      ),
      headers: bearer ? { Authorization: `Bearer ${config.apiKey}` } : {},
      timeout: 15_000,
    })

  const provider: MetadataProvider = {
    id: 'tmdb',
    kinds: ['movie'],

    async search(query: SearchQuery) {
      const result = await get<{ results: TmdbMovie[] }>('/search/movie', {
        query: query.term,
        year: query.year,
        include_adult: 'false',
      })
      return result.results.map(base)
    },

    async getMovie(tmdbId: string): Promise<MovieMetadata> {
      const movie = await get<TmdbMovie>(`/movie/${tmdbId}`, {
        append_to_response: 'release_dates,alternative_titles',
      })
      return {
        ...base(movie),
        kind: 'movie',
        runtimeMinutes: movie.runtime || undefined,
        originalLanguage: movie.original_language,
        backdropUrl: movie.backdrop_path ? `${IMAGE}w1280${movie.backdrop_path}` : undefined,
        genres: movie.genres?.map((g) => g.name),
        alternateTitles: [
          ...new Set(
            [
              movie.original_title,
              ...(movie.alternative_titles?.titles ?? []).map((t) => t.title),
            ].filter((t): t is string => !!t && t !== movie.title),
          ),
        ],
        releaseDates: {
          theatrical: earliest(movie, [2, 3]),
          digital: earliest(movie, [4]),
          physical: earliest(movie, [5]),
        },
      }
    },

    async mapIds(ids) {
      if (ids.tmdb || !ids.imdb) return ids
      const found = await get<{ movie_results: TmdbMovie[] }>(`/find/${ids.imdb}`, {
        external_source: 'imdb_id',
      })
      const movie = found.movie_results[0]
      return movie ? { ...ids, tmdb: String(movie.id) } : ids
    },
  }

  ctx.metadata.register(provider)
}
