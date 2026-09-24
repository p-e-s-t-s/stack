// Automatic searching and grabbing for books: on follow, after a failed download, a daily
// sweep of wanted books, and RSS. Active while both an indexers and a downloads plugin are
// loaded.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import type { Context } from 'cordis'
import { type BooksService, pickReleases } from './index'
import { matchBooks } from './match'
import { parseBook } from './parse'
import { authorNames, type FoundRelease } from './search'

const DAY = 86_400_000

export default function automation(ctx: Context, books: BooksService, config = { sweepBatch: 20 }) {
  const enqueue = (mediaId: number, bookIds?: number[]) =>
    ctx.jobs.enqueue(
      'books.search',
      { mediaId, bookIds },
      { dedupeKey: `books.search:${mediaId}:${bookIds?.join(',') ?? 'wanted'}` },
    )

  ctx.jobs.define(
    'books.search',
    async ({ mediaId, bookIds }: { mediaId: number; bookIds?: number[] }) => {
      const follow = books.get(mediaId)
      if (!follow?.monitored) return
      // only books that are still wanted (a file may have arrived meanwhile)
      const wanted = new Set(books.wantedBooks(mediaId).map((b) => b.id))
      const ids = (bookIds ?? [...wanted]).filter((id) => wanted.has(id))
      if (!ids.length) return
      const grabbed = await books.searchAndGrab(mediaId, ids)
      if (!grabbed.length) ctx.logger.info('no acceptable release found for %s', follow.title)
    },
    { maxAttempts: 3, retryDelayMs: 5 * 60_000 },
  )

  ctx.on('books/added', (follow, options) => {
    if (options.search) enqueue(follow.id)
  })

  // a failed download is blocklisted by the downloads plugin; look for the next best release
  ctx.on('downloads/failed', (grab) => {
    if (books.get(grab.mediaId)) enqueue(grab.mediaId, books.grabBooks(grab.id))
  })

  // daily: authors with wanted books that weren't searched in the last day, oldest first
  ctx.jobs.define('books.wanted', () => {
    const now = Date.now()
    const due = books
      .list()
      .filter((f) => f.monitored)
      .map((follow) => {
        const wanted = books.wantedBooks(follow.id, now)
        const last = Math.min(...wanted.map((b) => b.lastSearchedAt ?? 0))
        return { follow, wanted, last }
      })
      .filter(({ wanted, last }) => wanted.length && now - last > DAY)
      .sort((a, b) => a.last - b.last)
      .slice(0, config.sweepBatch)
    for (const { follow } of due) enqueue(follow.id)
  })
  ctx.jobs.schedule('books.wanted', 'books.wanted', DAY)

  // RSS: releases that are a wanted book of a followed author, in that follow's format
  ctx.on('indexers/rss', async (releases) => {
    const follows = books.list().filter((f) => f.monitored)
    if (!follows.length || !books.searcher || !books.grabber) return
    const byFollow = new Map<number, FoundRelease[]>()
    for (const release of releases as FoundRelease[]) {
      const parsed = parseBook(release.title)
      if (parsed.kind === 'unknown') continue
      for (const follow of follows) {
        if (follow.kind !== parsed.kind) continue
        if (matchBooks(parsed, authorNames(follow), books.books(follow.id)).length)
          byFollow.set(follow.id, [...(byFollow.get(follow.id) ?? []), release])
      }
    }
    for (const [mediaId, candidates] of byFollow) {
      const wanted = new Set(books.wantedBooks(mediaId).map((b) => b.id))
      if (!wanted.size) continue
      for (const result of pickReleases(
        books.searcher.evaluate(mediaId, candidates, wanted),
        wanted,
      )) {
        try {
          await books.grabber(mediaId, result, false)
        } catch (error) {
          ctx.logger.warn('could not grab %s from RSS: %s', result.release.title, error)
        }
      }
    }
  })
}
