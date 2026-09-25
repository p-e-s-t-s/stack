import { DOWNLOAD_LABELS, downloadStatus } from '@magpiejs/console-kit'
import type { PodcastEpisodeRow, PodcastSummary } from '../src/console'

/** Badge for a podcast on the grid. */
export function podcastStatus(p: PodcastSummary) {
  if (p.refreshError) return { text: 'Feed error', class: 'bad' }
  if (!p.monitored) return { text: 'Paused', class: '' }
  if (p.stats.wanted) return { text: `${p.stats.wanted} to download`, class: 'info' }
  return { text: 'Up to date', class: 'ok' }
}

/** A grabbed episode just moves to the download client's queue, so it stays "Queued" here. */
const EPISODE_LABELS: Record<string, string> = { ...DOWNLOAD_LABELS, grabbed: 'Queued' }

/** Badge for one episode. */
export function episodeStatus(e: PodcastEpisodeRow) {
  if (e.download) {
    const { state, progress } = e.download
    return state === 'downloading'
      ? downloadStatus(state, progress)
      : { text: EPISODE_LABELS[state] ?? state, class: 'info' }
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
