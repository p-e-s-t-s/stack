import type { PodcastEpisodeRow, PodcastSummary } from '../src/console'

/** Badge for a podcast on the grid. */
export function podcastStatus(p: PodcastSummary) {
  if (p.refreshError) return { text: 'Feed error', class: 'bad' }
  if (!p.monitored) return { text: 'Paused', class: '' }
  if (p.stats.wanted) return { text: `${p.stats.wanted} to download`, class: 'info' }
  return { text: 'Up to date', class: 'ok' }
}

const DOWNLOAD: Record<string, string> = {
  grabbed: 'Queued',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Importing soon',
  importing: 'Importing',
}

/** Badge for one episode. */
export function episodeStatus(e: PodcastEpisodeRow) {
  if (e.download) {
    const { state, progress } = e.download
    const text =
      state === 'downloading'
        ? `Downloading ${Math.floor(progress * 100)}%`
        : (DOWNLOAD[state] ?? state)
    return { text, class: 'info' }
  }
  if (e.file) return { text: 'Downloaded', class: 'ok' }
  if (e.failed) return { text: 'Failed', class: 'bad' }
  if (!e.monitored) return { text: '', class: '' }
  return { text: 'Wanted', class: 'info' }
}

export const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')

export function duration(seconds: number | null) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`
