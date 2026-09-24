import type { EpisodeRow, SeriesSummary } from '../src/console'

/** Badge for a series on the grid: how complete it is. */
export function seriesStatus(s: SeriesSummary) {
  const { wanted, downloaded } = s.stats
  if (!s.monitored) return { text: 'Not monitored', class: '' }
  if (!wanted) return { text: s.stats.nextAiring ? 'Upcoming' : 'Nothing aired', class: '' }
  if (downloaded >= wanted) return { text: 'Complete', class: 'ok' }
  return { text: `${wanted - downloaded} missing`, class: 'bad' }
}

/** Badge for one episode. */
const DOWNLOAD: Record<string, string> = {
  grabbed: 'Sent to client',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Importing soon',
  importing: 'Importing',
}

export function episodeStatus(e: EpisodeRow) {
  if (e.download) {
    const { state, progress } = e.download
    const text =
      state === 'downloading'
        ? `Downloading ${Math.floor(progress * 100)}%`
        : (DOWNLOAD[state] ?? state)
    return { text, class: 'info' }
  }
  if (e.file) return { text: e.file.quality, class: 'ok' }
  if (!e.aired) return { text: e.airDate ? 'Upcoming' : 'TBA', class: '' }
  if (!e.monitored) return { text: 'Not monitored', class: '' }
  return { text: 'Missing', class: 'bad' }
}

export const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
