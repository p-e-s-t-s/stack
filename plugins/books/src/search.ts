// Book searching. Loaded only while an indexers plugin is enabled: builds queries for the
// wanted books, matches results to the author's books, and runs them through the decision
// engine with the item's (ebook or audiobook) profile.

import {
  compareDecisions,
  type Decision,
  type DecisionTarget,
  profileRanks,
} from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import type { ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { BooksService, Follow, TrackedBook } from './index'
import { matchBooks } from './match'
import { parseBook } from './parse'

export type FoundRelease = ReleaseInfo & {
  indexerName: string
  indexerPriority: number
}

export interface BookResult {
  release: FoundRelease
  decision: Decision
  /** The book this release is (empty when it isn't one of the author's). */
  bookIds: number[]
}

export interface BookSearch {
  search(
    mediaId: number,
    bookIds: number[],
    kind?: 'automatic' | 'interactive',
  ): Promise<{ results: BookResult[]; errors: { indexer: string; message: string }[] }>
  cached(mediaId: number, guid: string): BookResult | undefined
  /** Matches and evaluates releases for an author, best first (used by search and RSS). */
  evaluate(mediaId: number, releases: FoundRelease[], wantedIds: Set<number>): BookResult[]
}

/** Per-book queries for a few books; one query for the author when many are wanted. */
const PER_BOOK = 10

export const authorNames = (follow: Follow) => [follow.author.name, ...follow.author.alternateNames]

export default function bookSearch(ctx: Context, books: BooksService) {
  const cache = new Map<number, { at: number; results: Map<string, BookResult> }>()

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

  const api: BookSearch = {
    async search(mediaId, bookIds, kind = 'automatic') {
      const follow = books.get(mediaId)
      if (!follow) throw new Error(`author ${mediaId} not found`)
      const wanted = books.books(mediaId).filter((b) => bookIds.includes(b.id))
      if (!wanted.length) return { results: [], errors: [] }
      const releases: FoundRelease[] = []
      const errors: { indexer: string; message: string }[] = []
      for (const query of queries(follow, wanted)) {
        const outcome = await ctx.indexers.search(query, kind)
        releases.push(...(outcome.releases as FoundRelease[]))
        errors.push(...outcome.errors)
      }
      const wantedIds = new Set(wanted.map((b) => b.id))
      const results = api.evaluate(mediaId, releases, wantedIds)
      cache.set(mediaId, {
        at: Date.now(),
        results: new Map(results.map((r) => [r.release.guid, r])),
      })
      books.markSearched(mediaId, [...wantedIds])
      return { results, errors }
    },

    evaluate(mediaId, releases, wantedIds) {
      const follow = books.get(mediaId)
      if (!follow) return []
      const all = books.books(mediaId)
      const names = authorNames(follow)
      const seen = new Set<string>()
      const results: BookResult[] = []
      for (const release of releases) {
        if (seen.has(release.guid)) continue
        seen.add(release.guid)
        const parsed = parseBook(release.title)
        const [book] = matchBooks(parsed, names, all)
        const decision = ctx.decision.evaluate({ info: release, parsed }, targetFor(follow, book))
        const reject = (rule: string, reason: string) => {
          decision.rejections.unshift({ rule, reason, permanent: true })
          decision.accepted = false
        }
        if (!book) reject('book-match', `is not a book by ${follow.author.name}`)
        else if (!wantedIds.has(book.id))
          reject('book-match', `is ${book.title}, which isn't wanted`)
        decision.rank.push(-release.indexerPriority)
        results.push({ release, decision, bookIds: book ? [book.id] : [] })
      }
      return results.sort(
        (a, b) =>
          Number(b.decision.accepted) - Number(a.decision.accepted) ||
          compareDecisions(a.decision, b.decision),
      )
    },

    cached(mediaId, guid) {
      const entry = cache.get(mediaId)
      if (!entry || Date.now() - entry.at > 60 * 60_000) return
      return entry.results.get(guid)
    },
  }

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
