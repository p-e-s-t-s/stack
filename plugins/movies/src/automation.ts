// Automatic searching and grabbing for movies (docs/phase-3.md §4.2): on add, after a
// failed download, from RSS, and a daily sweep of wanted movies. Active while both an
// indexers and a downloads plugin are loaded.

import { compareDecisions, cutoffMet, type Decision } from '@magpiejs/decision'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import { normalizeTitle, parse } from '@magpiejs/parser'
import type { Context } from 'cordis'
import { isAvailable, type Movie, type MoviesService } from './index'
import { type FoundRelease, matchesMovie, targetFor } from './search'

const DAY = 86_400_000

export interface AutomationConfig {
  /** Movies searched per daily sweep. */
  sweepBatch: number
}

export default function automation(
  ctx: Context,
  movies: MoviesService,
  config: AutomationConfig = { sweepBatch: 20 },
) {
  /** Monitored, available, and missing or below the cutoff. */
  const wanted = (movie: Movie) => {
    if (!movie.monitored || !isAvailable(movie.details)) return false
    if (!movie.file) return true
    const profile = ctx.decision.profile(movie.profileId)
    return !!profile && !cutoffMet(profile, movie.file)
  }

  /** Searches a movie and grabs the best accepted release. Returns what was grabbed. */
  async function searchAndGrab(movieId: number) {
    const movie = movies.get(movieId)
    if (!movie || !wanted(movie)) return
    const { results } = await movies.search(movieId, 'automatic')
    const best = results.find((r) => r.decision.accepted)
    if (!best) {
      ctx.logger.info('no acceptable release found for %s', movie.title)
      return
    }
    return ctx.downloads.grab(movieId, best.release, {
      quality: best.decision.quality,
      formatScore: best.decision.formatScore,
    })
  }

  const enqueue = (movieId: number) =>
    ctx.jobs.enqueue('movies.search', { movieId }, { dedupeKey: `movies.search:${movieId}` })

  ctx.jobs.define(
    'movies.search',
    ({ movieId }: { movieId: number }) => searchAndGrab(movieId).then(() => {}),
    {
      maxAttempts: 3,
      retryDelayMs: 5 * 60_000,
    },
  )

  ctx.on('movies/added', (movie, options) => {
    if (options.search) enqueue(movie.id)
  })

  // a failed download is blocklisted by the downloads plugin; look for the next best release
  ctx.on('downloads/failed', (grab) => {
    if (movies.get(grab.mediaId)) enqueue(grab.mediaId)
  })

  ctx.jobs.define('movies.wanted', () => {
    const now = Date.now()
    const due = movies
      .list()
      .filter(wanted)
      .filter((m) => !m.details.lastSearchedAt || now - m.details.lastSearchedAt > DAY)
      .sort((a, b) => (a.details.lastSearchedAt ?? 0) - (b.details.lastSearchedAt ?? 0))
      .slice(0, config.sweepBatch)
    for (const movie of due) enqueue(movie.id)
  })
  ctx.jobs.schedule('movies.wanted', 'movies.wanted', DAY)

  // RSS: match each new release to wanted movies, grab the best one per movie
  ctx.on('indexers/rss', async (releases) => {
    const best = new Map<number, { release: FoundRelease; decision: Decision }>()
    const evaluators = new Map<number, ReturnType<typeof ctx.decision.evaluator>>()
    for (const release of releases as FoundRelease[]) {
      const parsed = parse(release.title)
      if (parsed.kind !== 'movie') continue
      const candidates = movies.findForRelease(release, parsed)
      for (const movie of candidates) {
        if (!wanted(movie)) continue
        const titles = new Set(ctx.library.alternateTitlesOf(movie.id).map(normalizeTitle))
        if (!matchesMovie(movie, release, parsed, titles)) continue
        let evaluate = evaluators.get(movie.id)
        if (!evaluate)
          evaluators.set(movie.id, (evaluate = ctx.decision.evaluator(targetFor(movie))))
        const decision = evaluate({ info: release, parsed })
        if (!decision.accepted) continue
        const current = best.get(movie.id)
        if (!current || compareDecisions(decision, current.decision) < 0)
          best.set(movie.id, { release, decision })
      }
    }
    for (const [movieId, { release, decision }] of best) {
      try {
        await ctx.downloads.grab(movieId, release, {
          quality: decision.quality,
          formatScore: decision.formatScore,
        })
      } catch (error) {
        ctx.logger.warn('could not grab %s from RSS: %s', release.title, error)
      }
    }
  })

  ctx.effect(() => {
    movies.searchAndGrab = searchAndGrab
    return () => (movies.searchAndGrab = undefined)
  }, 'movies.automation')
}
