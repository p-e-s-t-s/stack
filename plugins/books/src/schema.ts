import { mediaFiles, mediaItems } from '@magpiejs/library/schema'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Which books to monitor when an author is followed. */
export type MonitorOption = 'all' | 'future' | 'latest' | 'none'

/**
 * Authors and their books, shared by the ebook and audiobook library items of an author (an
 * author followed in both formats is two library items: one root folder and profile each).
 */
export const authors = sqliteTable('books_authors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Open Library author key: `OL7234434A`. */
  openlibraryId: text('openlibrary_id').notNull().unique(),
  name: text('name').notNull(),
  overview: text('overview'),
  photoUrl: text('photo_url'),
  alternateNames: text('alternate_names', { mode: 'json' }).$type<string[]>().notNull(),
  refreshedAt: integer('refreshed_at'),
})

export const books = sqliteTable(
  'books_books',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    authorId: integer('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    /** Open Library work key: `OL17091839W`. */
    openlibraryId: text('openlibrary_id').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    year: integer('year'),
    /** ISO date of the first publication, when known. */
    releaseDate: text('release_date'),
    coverUrl: text('cover_url'),
    editions: integer('editions'),
  },
  (t) => [
    uniqueIndex('books_books_openlibrary_idx').on(t.authorId, t.openlibraryId),
    index('books_books_release_idx').on(t.releaseDate),
  ],
)

/** An author followed in one format: the library item's side of an author. */
export const followed = sqliteTable(
  'books_followed',
  {
    mediaId: integer('media_id')
      .primaryKey()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    authorId: integer('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    /** Monitor books that appear later. */
    monitorNew: integer('monitor_new', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('books_followed_author_idx').on(t.authorId)],
)

/** Whether a book is wanted in a format (per library item). */
export const monitoring = sqliteTable(
  'books_monitoring',
  {
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    monitored: integer('monitored', { mode: 'boolean' }).notNull(),
    lastSearchedAt: integer('last_searched_at'),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.bookId] })],
)

/** Which book a library file belongs to (an audiobook may be many files). */
export const bookFiles = sqliteTable(
  'books_book_files',
  {
    fileId: integer('file_id')
      .primaryKey()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
  },
  (t) => [index('books_book_files_book_idx').on(t.bookId)],
)

export type Author = typeof authors.$inferSelect
export type Book = typeof books.$inferSelect
export type Followed = typeof followed.$inferSelect
