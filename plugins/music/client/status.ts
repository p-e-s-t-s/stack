import type { AlbumRow, ArtistSummary } from '../src/console'

export function artistStatus(a: ArtistSummary) {
  if (!a.monitored) return { text: 'Not monitored', class: '' }
  const missing = a.stats.wanted - a.stats.complete
  if (missing) return { text: `${missing} missing`, class: 'bad' }
  return {
    text: a.stats.wanted ? 'Complete' : 'Nothing released',
    class: a.stats.wanted ? 'ok' : '',
  }
}

const DOWNLOAD: Record<string, string> = {
  grabbed: 'Sent to client',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Importing soon',
  importing: 'Importing',
}

export function albumStatus(a: AlbumRow) {
  if (a.download) {
    const { state, progress } = a.download
    const text =
      state === 'downloading'
        ? `Downloading ${Math.floor(progress * 100)}%`
        : (DOWNLOAD[state] ?? state)
    return { text, class: 'info' }
  }
  if (a.files && a.tracks !== null && a.files >= a.tracks)
    return { text: a.quality ?? 'Complete', class: 'ok' }
  if (a.files)
    return { text: `${a.files}${a.tracks ? ` of ${a.tracks}` : ''} tracks`, class: 'bad' }
  if (!a.released) return { text: a.releaseDate ? 'Upcoming' : 'Unreleased', class: '' }
  if (!a.monitored) return { text: 'Not monitored', class: '' }
  return { text: 'Missing', class: 'bad' }
}

/** Section an album is listed under on the artist page. */
export function albumGroup(a: Pick<AlbumRow, 'primaryType' | 'secondaryTypes'>) {
  const secondary = a.secondaryTypes[0]
  if (secondary === 'Live') return 'Live'
  if (secondary === 'Compilation') return 'Compilations'
  if (secondary) return 'Other'
  return { Album: 'Albums', EP: 'EPs', Single: 'Singles' }[a.primaryType ?? ''] ?? 'Other'
}
export const GROUPS = ['Albums', 'EPs', 'Singles', 'Live', 'Compilations', 'Other']

export const duration = (ms: number | null) =>
  ms
    ? `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}`
    : ''

export const mb = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`
