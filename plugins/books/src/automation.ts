// Automatic searching and grabbing for books: on follow, after a failed download, a daily
// sweep of wanted books, and RSS — with @magpiejs/units. Active while both an indexers and a
// downloads plugin are loaded.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import { unitAutomation } from '@magpiejs/units'
import type { Context } from 'cordis'
import type { BooksService } from './index'
import { matchBooks } from './match'
import { parseBook } from './parse'
import { authorNames } from './search'

export default function automation(ctx: Context, books: BooksService) {
  const { enqueue } = unitAutomation(ctx, {
    name: 'books',
    item: (id) => books.get(id),
    items: () => books.list(),
    wanted: (id, now) => books.wantedBooks(id, now),
    searcher: () => books.searcher,
    searchAndGrab: (id, ids) => books.searchAndGrab(id, ids),
    grab: (id, result) => books.grabber!(id, result, false),
    // a wanted book of a followed author, in that follow's format
    rssItems(release) {
      const parsed = parseBook(release.title)
      if (parsed.kind === 'unknown') return []
      return books
        .list(parsed.kind)
        .filter((f) => f.monitored)
        .filter((f) => matchBooks(parsed, authorNames(f), books.books(f.id)).length)
        .map((f) => f.id)
    },
  })

  ctx.on('books/added', (follow, options) => {
    if (options.search) enqueue(follow.id)
  })
}
