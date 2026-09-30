import { DOWNLOAD_LABELS, downloadStatus, missing, notMonitored } from '@magpiejs/console-kit'
import type { MovieSummary } from '../src/console'

export const downloadLabel = (state: string) => DOWNLOAD_LABELS[state] ?? state

/** The one-word state of a movie, with a badge class. */
export function movieStatus(m: MovieSummary) {
  if (m.download) return downloadStatus(m.download.state, m.download.progress)
  if (m.file) {
    // a movie with extra versions is only downloaded once every monitored version is
    const absent = m.versions.filter((v) => v.monitored && !v.file)
    return absent.length
      ? { text: `Missing ${absent.map((v) => v.name).join(', ')}`, class: 'bad' }
      : { text: 'Downloaded', class: 'ok' }
  }
  if (!m.monitored) return notMonitored()
  if (!m.available) return { text: 'Not released yet', class: '' }
  return missing()
}

export { fileSize as gb } from '@magpiejs/console-kit'
