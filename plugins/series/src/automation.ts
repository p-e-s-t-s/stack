// Automatic searching and grabbing for series (docs/phase-4.md §4.4): on add, after a failed
// download, a daily sweep of wanted episodes, and RSS — with @magpiejs/units. Active while
// both an indexers and a downloads plugin are loaded.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import { parse } from '@magpiejs/parser'
import { unitAutomation } from '@magpiejs/units'
import type { Context } from 'cordis'
import type { SeriesService } from './index'

export interface AutomationConfig {
  /** Series searched per daily sweep. */
  sweepBatch: number
}

export default function automation(
  ctx: Context,
  series: SeriesService,
  config: AutomationConfig = { sweepBatch: 20 },
) {
  const { enqueue } = unitAutomation(ctx, {
    name: 'series',
    item: (id) => series.get(id),
    items: () => series.list(),
    wanted: (id, now) => series.wantedEpisodes(id, now),
    searcher: () => series.searcher,
    searchAndGrab: (id, ids) => series.searchAndGrab(id, ids),
    grab: (id, result) => series.grabber!(id, result, false),
    rssItems(release) {
      const parsed = parse(release.title, { kind: 'series' })
      if (parsed.kind !== 'episode' && parsed.kind !== 'season') return []
      return series
        .findForRelease(release, parsed)
        .filter((show) => show.monitored)
        .map((show) => show.id)
    },
    sweepBatch: config.sweepBatch,
  })

  ctx.on('series/added', (show, options) => {
    if (options.search) enqueue(show.id)
  })
}
