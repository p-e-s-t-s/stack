import { downloadStatus } from '@magpiejs/console-kit'
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

/** Badge for a book in one format. */
export function formatStatus(book: BookRow, state: BookFormatState) {
  if (state.download) return downloadStatus(state.download.state, state.download.progress)
  if (state.files?.length) return { text: state.files[0]!.quality, class: 'ok' }
  if (!book.released) return { text: book.releaseDate ? 'Upcoming' : 'Unreleased', class: '' }
  if (!state.monitored) return { text: 'Not monitored', class: '' }
  return { text: 'Missing', class: 'bad' }
}
