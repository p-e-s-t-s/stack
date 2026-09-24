// @magpiejs/metadata-tmdb: movie and TV metadata from The Movie Database (themoviedb.org).

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/metadata'
import type {
  EpisodeMetadata,
  MetadataProvider,
  MetadataSearchResult,
  MovieMetadata,
  SearchQuery,
  SeriesMetadata,
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

interface TmdbSeries {
  id: number
  name: string
  original_name?: string
  original_language?: string
  first_air_date?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  status?: string
  networks?: { name: string }[]
  genres?: { name: string }[]
  episode_run_time?: number[]
  seasons?: {
    season_number: number
    name?: string
    episode_count: number
    poster_path?: string | null
  }[]
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null }
  alternative_titles?: { results: { title: string }[] }
}

interface TmdbEpisode {
  season_number: number
  episode_number: number
  name?: string
  overview?: string
  air_date?: string | null
  runtime?: number | null
}

function seriesBase(series: TmdbSeries): MetadataSearchResult {
  const year = series.first_air_date ? Number(series.first_air_date.slice(0, 4)) : undefined
  const ids: MetadataSearchResult['ids'] = { tmdb: String(series.id) }
  if (series.external_ids?.imdb_id) ids.imdb = series.external_ids.imdb_id
  if (series.external_ids?.tvdb_id) ids.tvdb = String(series.external_ids.tvdb_id)
  return {
    kind: 'series',
    title: series.name,
    year: year || undefined,
    overview: series.overview || undefined,
    posterUrl: series.poster_path ? `${IMAGE}w500${series.poster_path}` : undefined,
    ids,
  }
}

const STATUS: Record<string, SeriesMetadata['status']> = {
  'Returning Series': 'continuing',
  'In Production': 'continuing',
  Planned: 'upcoming',
  Pilot: 'upcoming',
  Ended: 'ended',
  Canceled: 'ended',
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
    kinds: ['movie', 'series'],

    async search(query: SearchQuery) {
      if (query.kind === 'series') {
        const result = await get<{ results: TmdbSeries[] }>('/search/tv', {
          query: query.term,
          first_air_date_year: query.year,
          include_adult: 'false',
        })
        return result.results.map(seriesBase)
      }
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

    async getSeries(tmdbId: string): Promise<SeriesMetadata> {
      const series = await get<TmdbSeries>(`/tv/${tmdbId}`, {
        append_to_response: 'external_ids,alternative_titles',
      })
      return {
        ...seriesBase(series),
        kind: 'series',
        status: STATUS[series.status ?? ''],
        network: series.networks?.[0]?.name,
        runtimeMinutes: series.episode_run_time?.[0] || undefined,
        originalLanguage: series.original_language,
        backdropUrl: series.backdrop_path ? `${IMAGE}w1280${series.backdrop_path}` : undefined,
        genres: series.genres?.map((g) => g.name),
        firstAired: series.first_air_date || undefined,
        alternateTitles: [
          ...new Set(
            [
              series.original_name,
              ...(series.alternative_titles?.results ?? []).map((t) => t.title),
            ].filter((t): t is string => !!t && t !== series.name),
          ),
        ],
        seasons: (series.seasons ?? []).map((season) => ({
          number: season.season_number,
          title: season.name || undefined,
          episodeCount: season.episode_count,
          posterUrl: season.poster_path ? `${IMAGE}w342${season.poster_path}` : undefined,
        })),
      }
    },

    async getEpisodes(tmdbId: string): Promise<EpisodeMetadata[]> {
      const series = await get<TmdbSeries>(`/tv/${tmdbId}`)
      const numbers = (series.seasons ?? []).map((s) => s.season_number)
      const episodes: EpisodeMetadata[] = []
      // TMDB appends up to 20 sub-requests per call
      for (let i = 0; i < numbers.length; i += 20) {
        const chunk = numbers.slice(i, i + 20)
        const result = await get<Record<string, { episodes?: TmdbEpisode[] }>>(`/tv/${tmdbId}`, {
          append_to_response: chunk.map((n) => `season/${n}`).join(','),
        })
        for (const n of chunk) {
          for (const e of result[`season/${n}`]?.episodes ?? []) {
            episodes.push({
              season: e.season_number,
              number: e.episode_number,
              title: e.name || undefined,
              overview: e.overview || undefined,
              airDate: e.air_date || undefined,
              runtimeMinutes: e.runtime || undefined,
            })
          }
        }
      }
      return episodes
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
