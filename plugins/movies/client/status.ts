import type { MovieSummary } from '../src/console'

const STATES: Record<string, string> = {
  grabbed: 'Sent to client',
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Importing soon',
  importing: 'Importing',
}

export const downloadLabel = (state: string) => STATES[state] ?? state

/** The one-word state of a movie, with a badge class. */
export function movieStatus(m: MovieSummary) {
  if (m.download) {
    const label = downloadLabel(m.download.state)
    const pct = Math.floor(m.download.progress * 100)
    return { text: m.download.state === 'downloading' ? `${label} ${pct}%` : label, class: 'info' }
  }
  if (m.file) return { text: 'Downloaded', class: 'ok' }
  if (!m.monitored) return { text: 'Not monitored', class: '' }
  if (!m.available) return { text: 'Not released yet', class: '' }
  return { text: 'Missing', class: 'bad' }
}

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
