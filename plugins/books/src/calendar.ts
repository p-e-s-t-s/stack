// Books on the calendar by release date, for each format an author is followed in. Loaded only
// while the calendar plugin is enabled.

import { entryState } from '@magpiejs/calendar'
import type { Context } from 'cordis'
import { and, gte, lte } from 'drizzle-orm'
import { BOOK_KINDS, type BooksService } from './index'
import * as schema from './schema'

export default function bookCalendar(ctx: Context, books: BooksService) {
  for (const kind of BOOK_KINDS) {
    ctx.calendar.source(kind, (from, to, now) => {
      const dated = new Set(
        books.db
          .select()
          .from(schema.books)
          .where(and(gte(schema.books.releaseDate, from), lte(schema.books.releaseDate, to)))
          .all()
          .map((b) => b.id),
      )
      if (!dated.size) return []
      return books.list(kind).flatMap((follow) => {
        const files = books.bookFiles(follow.id)
        return books
          .books(follow.id)
          .filter((b) => dated.has(b.id))
          .map((book) => ({
            uid: `${kind}-${follow.id}-${book.id}`,
            date: book.releaseDate!,
            kind,
            mediaId: follow.id,
            link: `/books/${follow.id}`,
            title: follow.author.name,
            subtitle: `${book.title} · ${kind === 'ebook' ? 'Ebook' : 'Audiobook'}`,
            state: entryState(
              book.releaseDate!,
              { hasFile: files.has(book.id), monitored: follow.monitored && book.monitored },
              now,
            ),
          }))
      })
    })
  }
  ctx.on('books/changed', () => ctx.emit('calendar/changed'))
}
