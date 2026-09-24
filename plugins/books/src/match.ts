// Which book a release is. Scene names run the author into the title and may put either
// first, so a release matches a book when its name holds the author and the title as whole
// words, and what's left over is only edition noise, the subtitle or the series.

import { foldedWords, WordCover } from '@magpiejs/parser'
import type { ParsedBook } from './parse'

/** Words for comparing names (see `foldedWords`). */
export const words = foldedWords

/** Words a release may add to a book's title. */
const NOISE = new Set(
  words(
    `edition anniversary special deluxe illustrated revised expanded updated complete unabridged
    abridged collectors collector definitive annotated novel a the book vol volume part
    svensk utgava utgave dansk udgave norsk deutsche ausgabe german english
    1st 2nd 3rd 4th 5th 10th 20th 25th 30th 40th 50th 60th 75th 100th`,
  ),
)

export interface BookCandidate {
  title: string
  subtitle?: string | null
}

/** Whether a release is this book by this author (any of the author's names). */
export function matchBook(parsed: ParsedBook, authors: string[], book: BookCandidate) {
  const name = new WordCover(parsed.name)
  const take = (needle: string[]) => name.take(needle)

  // the title, with or without a leading article
  const title = words(book.title)
  if (
    !take(title) &&
    !(title.length > 1 && /^(?:the|a|an)$/.test(title[0]!) && take(title.slice(1)))
  )
    return false
  // the author: the full name, or the surname when the release names an author
  const byAuthor = authors.some((a) => take(words(a)))
  if (!byAuthor) {
    const surnames = authors.map((a) => words(a).at(-1)!).filter(Boolean)
    const named = parsed.author ? words(parsed.author) : []
    if (!surnames.some((s) => named.includes(s) && take([s]))) return false
  }
  // what's left is the subtitle, the series or noise — or co-authors, when the release has an
  // author part and the author's full name is in it
  const allowed = new Set([
    ...words(book.subtitle ?? ''),
    ...words(parsed.series ?? ''),
    ...NOISE,
    ...(byAuthor && parsed.author ? ['and', ...words(parsed.author)] : []),
  ])
  return name.rest().every((w) => allowed.has(w) || /^\d+$/.test(w))
}

/** The books a release could be, best match (longest title) first. */
export function matchBooks<B extends BookCandidate>(
  parsed: ParsedBook,
  authors: string[],
  books: B[],
) {
  return books
    .filter((b) => matchBook(parsed, authors, b))
    .sort((a, b) => words(b.title).length - words(a.title).length)
}
