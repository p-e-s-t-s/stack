import type { NamingScheme } from '@magpiejs/library'

const TOKENS = ['Author Name', 'Book Title', 'Release Year', 'Quality']

/** Each book in a folder of its own, inside the author's folder. */
export const BOOK_NAMING: Record<'ebook' | 'audiobook', NamingScheme> = {
  ebook: {
    templates: {
      authorFolder: { label: 'Author folder', default: '{Author Name}' },
      bookFolder: { label: 'Book folder', default: '{Book Title} ({Release Year})' },
      bookFile: {
        label: 'Book file',
        default: '{Author Name} - {Book Title}',
        help: 'The file extension is added for you.',
      },
    },
    tokens: TOKENS,
  },
  audiobook: {
    templates: {
      authorFolder: { label: 'Author folder', default: '{Author Name}' },
      bookFolder: { label: 'Book folder', default: '{Book Title} ({Release Year})' },
      bookFile: {
        label: 'Book file',
        default: '{Author Name} - {Book Title}',
        help: 'For single-file audiobooks. Audiobooks in several files keep their file names, in order, inside the book folder.',
      },
    },
    tokens: TOKENS,
  },
}
