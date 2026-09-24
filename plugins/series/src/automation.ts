// Automatic searching and grabbing for series (docs/phase-4.md §4.4): on add, after a failed
// download, a daily sweep of wanted episodes, and RSS. Active while both an indexers and a
// downloads plugin are loaded.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import { parse } from '@magpiejs/parser'
import type { Context } from 'cordis'
import type { SeriesService } from './index'
import { type FoundRelease, pickReleases } from './search'

const DAY = 86_400_000

export interface AutomationConfig {
  /** Series searched per daily sweep. */
  sweepBatch: number
}

export default function automation(
  ctx: Context,
  series: SeriesService,
  config: AutomationConfig = { sweepBatch: 20 },
) {
  const enqueue = (seriesId: number, episodeIds?: number[]) =>
    ctx.jobs.enqueue(
      'series.search',
      { seriesId, episodeIds },
      // one pending search per series (or per set of episodes)
      { dedupeKey: `series.search:${seriesId}:${episodeIds?.join(',') ?? 'wanted'}` },
    )

  ctx.jobs.define(
    'series.search',
    async ({ seriesId, episodeIds }: { seriesId: number; episodeIds?: number[] }) => {
      const show = series.get(seriesId)
      if (!show?.monitored) return
      // only episodes that are still wanted (a file may have arrived meanwhile)
      const wanted = new Set(series.wantedEpisodes(seriesId).map((e) => e.id))
      const ids = (episodeIds ?? [...wanted]).filter((id) => wanted.has(id))
      if (!ids.length) return
      const grabbed = await series.searchAndGrab(seriesId, ids)
      if (!grabbed.length) ctx.logger.info('no acceptable release found for %s', show.title)
    },
    { maxAttempts: 3, retryDelayMs: 5 * 60_000 },
  )

  ctx.on('series/added', (show, options) => {
    if (options.search) enqueue(show.id)
  })

  // a failed download is blocklisted by the downloads plugin; look for the next best release
  ctx.on('downloads/failed', (grab) => {
    if (series.get(grab.mediaId)) enqueue(grab.mediaId, series.grabEpisodes(grab.id))
  })

  // daily: series with wanted episodes that weren't searched in the last day, oldest first
  ctx.jobs.define('series.wanted', () => {
    const now = Date.now()
    const due = series
      .list()
      .filter((show) => show.monitored)
      .map((show) => {
        const wanted = series.wantedEpisodes(show.id, now)
        const last = Math.min(...wanted.map((e) => e.lastSearchedAt ?? 0))
        return { show, wanted, last }
      })
      .filter(({ wanted, last }) => wanted.length && now - last > DAY)
      .sort((a, b) => a.last - b.last)
      .slice(0, config.sweepBatch)
    for (const { show } of due) enqueue(show.id)
  })
  ctx.jobs.schedule('series.wanted', 'series.wanted', DAY)

  // RSS: match new releases to series and their wanted episodes, grab the best per series
  ctx.on('indexers/rss', async (releases) => {
    const bySeries = new Map<number, FoundRelease[]>()
    for (const release of releases as FoundRelease[]) {
      const parsed = parse(release.title, { kind: 'series' })
      if (parsed.kind !== 'episode' && parsed.kind !== 'season') continue
      for (const show of series.findForRelease(release, parsed)) {
        if (show.monitored) bySeries.set(show.id, [...(bySeries.get(show.id) ?? []), release])
      }
    }
    for (const [seriesId, candidates] of bySeries) {
      const wanted = new Set(series.wantedEpisodes(seriesId).map((e) => e.id))
      if (!wanted.size || !series.searcher || !series.grabber) continue
      const results = series.searcher.evaluate(seriesId, candidates, wanted)
      for (const result of pickReleases(results, wanted)) {
        try {
          await series.grabber(seriesId, result, false)
        } catch (error) {
          ctx.logger.warn('could not grab %s from RSS: %s', result.release.title, error)
        }
      }
    }
  })
}
