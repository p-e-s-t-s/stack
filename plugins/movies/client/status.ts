import { DOWNLOAD_LABELS, downloadStatus } from '@magpiejs/console-kit'
import type { MovieSummary } from '../src/console'

export const downloadLabel = (state: string) => DOWNLOAD_LABELS[state] ?? state

/** The one-word state of a movie, with a badge class. */
export function movieStatus(m: MovieSummary) {
  if (m.download) return downloadStatus(m.download.state, m.download.progress)
  if (m.file) return { text: 'Downloaded', class: 'ok' }
  if (!m.monitored) return { text: 'Not monitored', class: '' }
  if (!m.available) return { text: 'Not released yet', class: '' }
  return { text: 'Missing', class: 'bad' }
}

export { fileSize as gb } from '@magpiejs/console-kit'
