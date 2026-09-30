import { downloadStatus, missing, missingCount, notMonitored } from '@magpiejs/console-kit'
import type { EpisodeRow, SeriesSummary } from '../src/console'

/** Badge for a series on the grid: how complete it is. */
export function seriesStatus(s: SeriesSummary) {
  const { wanted, downloaded } = s.stats
  if (!s.monitored) return notMonitored()
  if (!wanted) return { text: s.stats.nextAiring ? 'Upcoming' : 'Nothing aired', class: '' }
  if (downloaded >= wanted) return { text: 'Complete', class: 'ok' }
  return missingCount(wanted - downloaded)
}

/** Badge for one episode. */
export function episodeStatus(e: EpisodeRow) {
  if (e.download) return downloadStatus(e.download.state, e.download.progress)
  if (e.file) return { text: e.file.quality, class: 'ok' }
  if (!e.aired) return { text: e.airDate ? 'Upcoming' : 'TBA', class: '' }
  if (!e.monitored) return notMonitored()
  return missing()
}

export const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)
