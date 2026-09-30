// Automatic searching and grabbing for movies (docs/phase-3.md §4.2): on add, after a
// failed download, from RSS, and a daily sweep of wanted movies. Active while both an
// indexers and a downloads plugin are loaded.

import { compareDecisions, cutoffMet, type Decision } from '@magpiejs/decision'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import { normalizeTitle, parse } from '@magpiejs/parser'
import type { Context } from 'cordis'
import { isAvailable, type Movie, type MoviesService, type MovieTarget } from './index'
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
  /** The version has no file yet or its file is below the profile's cutoff. */
  const needs = (target: MovieTarget) => {
    if (!target.file) return true
    const profile = ctx.decision.profile(target.profileId)
    return !!profile && !cutoffMet(profile, target.file)
  }
  /** Whether the version is monitored (the primary one follows the movie). */
  const monitoredTarget = (movie: Movie, target: MovieTarget) =>
    target.id === null ? movie.monitored : target.monitored
  /** Monitored versions that are missing or below their cutoff. */
  const neededTargets = (movie: Movie) =>
    movie.targets.filter((t) => monitoredTarget(movie, t) && needs(t))
  /** Monitored, available, and some version is needed. */
  const wanted = (movie: Movie) =>
    movie.monitored && isAvailable(movie.details) && neededTargets(movie).length > 0

  /**
   * Searches a movie and grabs the best accepted release for each version that needs one.
   * Returns what was grabbed. `targetId` limits it to one version (`null` is the primary).
   * `manual` (the Search now button) also searches unmonitored and unreleased movies.
   */
  async function searchAndGrab(movieId: number, manual = false, targetId?: number | null) {
    const movie = movies.get(movieId)
    if (!movie) return
    if (!manual && !(movie.monitored && isAvailable(movie.details))) return
    const candidates = (
      targetId === undefined ? movie.targets : [movies.targetOf(movie, targetId)]
    ).filter((t) => needs(t) && (manual || monitoredTarget(movie, t)))
    const grabbed: string[] = []
    // a release that is moved into place (usenet) can only serve one version
    const moved = new Set<string>()
    for (const target of candidates) {
      const { results } = await movies.search(movieId, 'automatic', target.id)
      const best = results.find(
        (r) =>
          r.decision.accepted && !(r.release.protocol !== 'torrent' && moved.has(r.release.guid)),
      )
      if (!best) {
        ctx.logger.info(
          'no acceptable release found for %s%s',
          movie.title,
          target.name ? ` (${target.name})` : '',
        )
        continue
      }
      await ctx.downloads.grab(movieId, best.release, {
        quality: best.decision.quality,
        formatScore: best.decision.formatScore,
        targetId: target.id,
      })
      moved.add(best.release.guid)
      grabbed.push(best.release.title)
    }
    return grabbed.length ? { title: grabbed.join(', ') } : undefined
  }

  /** `targetId` undefined searches every version that needs a release. */
  const enqueue = (movieId: number, targetId?: number | null) =>
    ctx.jobs.enqueue(
      'movies.search',
      targetId === undefined ? { movieId } : { movieId, targetId },
      {
        dedupeKey: `movies.search:${movieId}:${targetId === undefined ? 'all' : (targetId ?? 'primary')}`,
      },
    )

  ctx.jobs.define(
    'movies.search',
    ({ movieId, targetId }: { movieId: number; targetId?: number | null }) =>
      searchAndGrab(movieId, false, targetId).then(() => {}),
    {
      maxAttempts: 3,
      retryDelayMs: 5 * 60_000,
    },
  )

  ctx.on('movies/added', (movie, options) => {
    if (options.search) enqueue(movie.id)
  })

  ctx.on('movies/target-added', (movie, target) => {
    if (target.monitored) enqueue(movie.id, target.id)
  })

  // a failed download is blocklisted by the downloads plugin (for every version); look for
  // the next best release for the version it was for
  ctx.on('downloads/failed', (grab) => {
    if (movies.get(grab.mediaId)) enqueue(grab.mediaId, grab.targetId ?? null)
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

  // RSS: match each new release to the wanted versions of each movie, grab the best per version
  ctx.on('indexers/rss', async (releases) => {
    const best = new Map<
      string,
      { movieId: number; targetId: number | null; release: FoundRelease; decision: Decision }
    >()
    const evaluators = new Map<string, ReturnType<typeof ctx.decision.evaluator>>()
    for (const release of releases as FoundRelease[]) {
      const parsed = parse(release.title)
      if (parsed.kind !== 'movie') continue
      const candidates = movies.findForRelease(release, parsed)
      for (const movie of candidates) {
        if (!wanted(movie)) continue
        const titles = new Set(ctx.library.alternateTitlesOf(movie.id).map(normalizeTitle))
        if (!matchesMovie(movie, release, parsed, titles)) continue
        for (const target of neededTargets(movie)) {
          const key = `${movie.id}:${target.id ?? 'primary'}`
          let evaluate = evaluators.get(key)
          if (!evaluate)
            evaluators.set(key, (evaluate = ctx.decision.evaluator(targetFor(movie, target))))
          const decision = evaluate({ info: release, parsed })
          if (!decision.accepted) continue
          const current = best.get(key)
          if (!current || compareDecisions(decision, current.decision) < 0)
            best.set(key, { movieId: movie.id, targetId: target.id, release, decision })
        }
      }
    }
    const moved = new Set<string>()
    for (const { movieId, targetId, release, decision } of best.values()) {
      if (release.protocol !== 'torrent' && moved.has(release.guid)) continue
      try {
        await ctx.downloads.grab(movieId, release, {
          quality: decision.quality,
          formatScore: decision.formatScore,
          targetId,
        })
        moved.add(release.guid)
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
