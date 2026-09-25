// Book searching. Loaded only while an indexers plugin is enabled: builds queries for the
// wanted books and matches results to the author's books (the searching, evaluating and
// caching itself is @magpiejs/units').

import { type DecisionTarget, profileRanks } from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import type { ReleaseQuery } from '@magpiejs/types'
import { unitSearch } from '@magpiejs/units'
import type { Context } from 'cordis'
import type { BooksService, Follow, TrackedBook } from './index'
import { matchBooks } from './match'
import { type ParsedBook, parseBook } from './parse'

export type {
  FoundRelease,
  UnitResult as BookResult,
  UnitSearch as BookSearch,
} from '@magpiejs/units'

/** Per-book queries for a few books; one query for the author when many are wanted. */
const PER_BOOK = 10

export const authorNames = (follow: Follow) => [follow.author.name, ...follow.author.alternateNames]

export default function bookSearch(ctx: Context, books: BooksService) {
  function queries(follow: Follow, wanted: TrackedBook[]): ReleaseQuery[] {
    const author = follow.author.name
    if (wanted.length > PER_BOOK) return [{ kind: follow.kind, term: author, fields: { author } }]
    return wanted.map((b) => ({
      kind: follow.kind,
      term: `${author} ${b.title}`,
      fields: { author, title: b.title },
    }))
  }

  function targetFor(follow: Follow, book: TrackedBook | undefined): DecisionTarget {
    const files = book ? books.bookFiles(follow.id).get(book.id) : undefined
    const profile = ctx.decision.profile(follow.profileId)
    const rankOf = profile ? profileRanks(profile).rankOf : () => 0
    const best = files?.slice().sort((a, b) => rankOf(b.quality) - rankOf(a.quality))[0]
    return {
      kind: 'book',
      mediaId: follow.id,
      profileId: follow.profileId,
      unitIds: book ? [book.id] : [],
      current: best && {
        quality: best.quality as never,
        formatScore: best.formatScore,
        revision: best.revision,
      },
    }
  }

  const api = unitSearch<Follow, TrackedBook>(ctx, {
    item: (id) => books.get(id),
    units: (id) => books.books(id),
    queries,
    parse: parseBook,
    matcher(follow, all, wanted) {
      const names = authorNames(follow)
      return (parsed) => {
        const [book] = matchBooks(parsed as ParsedBook, names, all)
        if (!book)
          return {
            reject: { rule: 'book-match', reason: `is not a book by ${follow.author.name}` },
          }
        if (!wanted.has(book.id))
          return { reject: { rule: 'book-match', reason: `is ${book.title}, which isn't wanted` } }
        return { units: [book] }
      }
    },
    target: (follow, _, covered) => targetFor(follow, covered[0]),
    markSearched: (id, ids) => books.markSearched(id, ids),
  })

  ctx.indexers.searchType('ebook', {
    mode: 'book',
    fields: ['author', 'title'],
    defaultCategories: [7000, 7020],
  })
  ctx.indexers.searchType('audiobook', {
    mode: 'book',
    fields: ['author', 'title'],
    defaultCategories: [3030],
  })

  ctx.effect(() => {
    books.searcher = api
    return () => (books.searcher = undefined)
  }, 'books.searcher')
}
