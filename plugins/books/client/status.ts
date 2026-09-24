import type { AuthorSummary, BookFormatState, BookRow } from '../src/console'

export const KINDS = ['ebook', 'audiobook'] as const
export const LABEL = { ebook: 'Ebooks', audiobook: 'Audiobooks' } as const
export const ONE = { ebook: 'Ebook', audiobook: 'Audiobook' } as const

/** The library item to open for an author: ebooks first. */
export const followIdOf = (a: AuthorSummary) => (a.formats.ebook ?? a.formats.audiobook)!.id

/** Badge for an author on the grid: missing books across formats. */
export function authorStatus(a: AuthorSummary) {
  const formats = Object.values(a.formats)
  if (!formats.some((f) => f.monitored)) return { text: 'Not monitored', class: '' }
  const missing = formats.reduce((n, f) => n + f.stats.wanted - f.stats.downloaded, 0)
  if (missing) return { text: `${missing} missing`, class: 'bad' }
  return { text: 'Complete', class: 'ok' }
}

const DOWNLOAD: Record<string, string> = {
  grabbed: 'Sent to client',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Importing soon',
  importing: 'Importing',
}

/** Badge for a book in one format. */
export function formatStatus(book: BookRow, state: BookFormatState) {
  if (state.download) {
    const { state: s, progress } = state.download
    const text =
      s === 'downloading' ? `Downloading ${Math.floor(progress * 100)}%` : (DOWNLOAD[s] ?? s)
    return { text, class: 'info' }
  }
  if (state.files?.length) return { text: state.files[0]!.quality, class: 'ok' }
  if (!book.released) return { text: book.releaseDate ? 'Upcoming' : 'Unreleased', class: '' }
  if (!state.monitored) return { text: 'Not monitored', class: '' }
  return { text: 'Missing', class: 'bad' }
}

export const mb = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`
