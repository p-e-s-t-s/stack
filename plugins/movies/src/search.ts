// Movie searching. Loaded only while an indexers plugin is enabled: builds the query for a
// movie, matches results to it, and runs them through the decision engine.

import { compareDecisions, type Decision, type DecisionTarget } from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import { normalizeTitle, type ParsedRelease, parse } from '@magpiejs/parser'
import type { ReleaseInfo } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { Movie, MoviesService } from './index'

export type FoundRelease = ReleaseInfo & {
  indexerName: string
  indexerPriority: number
  flags?: string[]
}

export interface SearchResult {
  release: FoundRelease
  decision: Decision
}

export interface MovieSearch {
  search(
    movieId: number,
    kind?: 'automatic' | 'interactive',
  ): Promise<{ results: SearchResult[]; errors: { indexer: string; message: string }[] }>
  /** Last interactive/automatic results, for grabbing by guid. */
  cached(movieId: number, guid: string): SearchResult | undefined
}

/** Whether a release is for this movie: indexer IDs if present, else title and year. */
export function matchesMovie(
  movie: Movie,
  info: ReleaseInfo,
  parsed: ParsedRelease,
  titles: Set<string>,
) {
  if (info.ids?.tmdb && movie.externalIds.tmdb) return info.ids.tmdb === movie.externalIds.tmdb
  if (info.ids?.imdb && movie.externalIds.imdb) return info.ids.imdb === movie.externalIds.imdb
  if (!titles.has(normalizeTitle(parsed.title))) return false
  return !parsed.year || !movie.year || Math.abs(parsed.year - movie.year) <= 1
}

export function targetFor(movie: Movie): DecisionTarget {
  return {
    kind: 'movie',
    mediaId: movie.id,
    profileId: movie.profileId,
    runtimeMinutes: movie.details.runtimeMinutes ?? undefined,
    originalLanguage: movie.details.originalLanguage ?? undefined,
    current: movie.file && {
      quality: movie.file.quality as never,
      formatScore: movie.file.formatScore,
      revision: movie.file.revision,
    },
  }
}

export default function movieSearch(ctx: Context, movies: MoviesService) {
  const cache = new Map<number, { at: number; results: Map<string, SearchResult> }>()

  const api: MovieSearch = {
    async search(movieId, kind = 'automatic') {
      const movie = movies.get(movieId)
      if (!movie) throw new Error(`movie ${movieId} not found`)
      const outcome = await ctx.indexers.search(
        {
          kind: 'movie',
          term: [movie.title, movie.year].filter(Boolean).join(' '),
          ids: movie.externalIds,
        },
        kind,
      )
      const titles = new Set(ctx.library.alternateTitlesOf(movie.id).map(normalizeTitle))
      const evaluate = ctx.decision.evaluator(targetFor(movie))
      const seen = new Set<string>()
      const results: SearchResult[] = []
      for (const release of outcome.releases as FoundRelease[]) {
        if (seen.has(release.guid)) continue
        seen.add(release.guid)
        const parsed = parse(release.title)
        const decision = evaluate({ info: release, parsed })
        if (!matchesMovie(movie, release, parsed, titles)) {
          decision.rejections.unshift({
            rule: 'movie-match',
            reason: 'is not this movie',
            permanent: true,
          })
          decision.accepted = false
        }
        // tie-break equal releases by indexer priority (lower first)
        decision.rank.push(-release.indexerPriority)
        results.push({ release, decision })
      }
      results.sort(
        (a, b) =>
          Number(b.decision.accepted) - Number(a.decision.accepted) ||
          compareDecisions(a.decision, b.decision),
      )
      cache.set(movieId, {
        at: Date.now(),
        results: new Map(results.map((r) => [r.release.guid, r])),
      })
      movies.markSearched(movieId)
      return { results, errors: outcome.errors }
    },
    cached(movieId, guid) {
      const entry = cache.get(movieId)
      if (!entry || Date.now() - entry.at > 60 * 60_000) return
      return entry.results.get(guid)
    },
  }

  ctx.indexers.searchType('movie', {
    mode: 'movie',
    ids: { imdb: 'imdbid', tmdb: 'tmdbid' },
    defaultCategories: [2000],
  })

  ctx.effect(() => {
    movies.searcher = api
    return () => (movies.searcher = undefined)
  }, 'movies.searcher')
}
