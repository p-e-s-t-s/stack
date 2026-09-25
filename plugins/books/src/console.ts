// Web console entry: Books (authors), Add author and Author detail pages. An author followed in
// both formats is one card and one page, with each format's settings and status side by side.

import type {} from '@magpiejs/webui'
import type { MetadataSearchResult, Protocol } from '@magpiejs/types'
import type { Context } from 'cordis'
import { type BookKind, type BooksService, BOOK_KINDS, type FollowStats, isReleased } from './index'
import type { MonitorOption } from './schema'

export interface FormatSummary {
  /** The library item (follow) id. */
  id: number
  monitored: boolean
  monitorNew: boolean
  profileId: number
  rootFolderId: number
  folder: string
  stats: FollowStats
}

export interface AuthorSummary {
  authorId: number
  /** Open Library author key, for following another format. */
  openlibraryId: string
  name: string
  overview: string | null
  photoUrl: string | null
  formats: Partial<Record<BookKind, FormatSummary>>
}

export interface BookFormatState {
  monitored: boolean
  files?: { path: string; quality: string; size: number }[]
  download?: { state: string; progress: number }
}

export interface BookRow {
  id: number
  title: string
  subtitle: string | null
  year: number | null
  releaseDate: string | null
  coverUrl: string | null
  released: boolean
  formats: Partial<Record<BookKind, BookFormatState>>
}

export interface ReleaseRow {
  guid: string
  title: string
  indexer: string
  protocol: Protocol
  size?: number
  seeders?: number
  leechers?: number
  unit: string
  quality: string
  formatScore: number
  matchedFormats: string[]
  accepted: boolean
  rejections: { rule: string; reason: string }[]
}

export interface BooksData {
  authors: AuthorSummary[]
  profiles: Record<BookKind, { id: number; name: string }[]>
  rootFolders: Record<BookKind, { id: number; path: string }[]>
  /** Bumped per author when their books, files or downloads change; pages refetch `books`. */
  revision: Record<number, number>
  lookup(
    term: string,
  ): Promise<(MetadataSearchResult & { followed: Partial<Record<BookKind, number>> })[]>
  follow(options: {
    authorId: string
    kind: BookKind
    profileId: number
    rootFolderId: number
    monitor: MonitorOption
    search: boolean
  }): Promise<number>
  books(authorId: number): Promise<BookRow[]>
  update(
    followId: number,
    patch: { profileId?: number; monitored?: boolean; monitorNew?: boolean },
  ): Promise<void>
  monitorBook(followId: number, bookId: number, monitored: boolean): Promise<void>
  refresh(followId: number): Promise<void>
  remove(followId: number, deleteFiles: boolean): Promise<void>
  search(
    followId: number,
    bookIds: number[],
  ): Promise<{ results: ReleaseRow[]; errors: { indexer: string; message: string }[] }>
  grab(followId: number, guid: string): Promise<void>
  /** Automatic search and grab (the wanted books when none are given). Says what happened. */
  searchNow(followId: number, bookIds?: number[]): Promise<string>
}

export default function console_(ctx: Context, books: BooksService) {
  const summaries = (): AuthorSummary[] => {
    const byAuthor = new Map<number, AuthorSummary>()
    for (const f of books.list()) {
      const summary = byAuthor.get(f.author.id) ?? {
        authorId: f.author.id,
        openlibraryId: f.author.openlibraryId,
        name: f.author.name,
        overview: f.author.overview,
        photoUrl: f.author.photoUrl,
        formats: {},
      }
      summary.formats[f.kind] = {
        id: f.id,
        monitored: f.monitored,
        monitorNew: f.details.monitorNew,
        profileId: f.profileId,
        rootFolderId: f.rootFolderId,
        folder: f.folder,
        stats: f.stats,
      }
      byAuthor.set(f.author.id, summary)
    }
    return [...byAuthor.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  const snapshot = () => ({
    authors: summaries(),
    profiles: Object.fromEntries(
      BOOK_KINDS.map((k) => [k, ctx.decision.profiles(k).map((p) => ({ id: p.id, name: p.name }))]),
    ) as BooksData['profiles'],
    rootFolders: Object.fromEntries(
      BOOK_KINDS.map((k) => [
        k,
        ctx.library.rootFolders(k).map((f) => ({ id: f.id, path: f.path })),
      ]),
    ) as BooksData['rootFolders'],
  })

  const changed = new Set<number>()
  const flush = ctx.debounce(
    () =>
      entry.mutate((d) => {
        Object.assign(d, snapshot())
        for (const id of changed) d.revision[id] = (d.revision[id] ?? 0) + 1
        changed.clear()
      }),
    100,
  )
  const touch = (mediaId?: number) => {
    const authorId = mediaId === undefined ? undefined : books.get(mediaId)?.author.id
    if (authorId !== undefined) changed.add(authorId)
    flush()
  }
  ctx.on('books/changed', (id) => touch(id))
  for (const event of ['library/added', 'library/updated', 'library/deleted'] as const)
    ctx.on(event, (item) => touch(item.id))
  for (const event of ['library/file-added', 'library/file-removed'] as const)
    ctx.on(event, (item) => touch(item.id))
  ctx.on('library/root-folders', () => touch())
  ctx.on('decision/families', () => touch())

  const follow = (id: number) => {
    const found = books.get(id)
    if (!found) throw new Error('that author is no longer followed')
    return found
  }

  const data: BooksData = {
    ...snapshot(),
    revision: {},
    lookup: (term) => books.lookup(term),
    async follow(options) {
      return (await books.follow(options)).id
    },
    async books(authorId) {
      const follows = books.list().filter((f) => f.author.id === authorId)
      const rows = new Map<number, BookRow>()
      for (const f of follows) {
        const files = books.bookFiles(f.id)
        const downloads = new Map<number, { state: string; progress: number }>()
        for (const grab of books.activeGrabs(f.id))
          for (const bookId of grab.unitIds)
            downloads.set(bookId, { state: grab.state, progress: grab.progress })
        for (const b of books.books(f.id)) {
          const row = rows.get(b.id) ?? {
            id: b.id,
            title: b.title,
            subtitle: b.subtitle,
            year: b.year,
            releaseDate: b.releaseDate,
            coverUrl: b.coverUrl,
            released: isReleased(b),
            formats: {},
          }
          row.formats[f.kind] = {
            monitored: b.monitored,
            files: files.get(b.id)?.map((file) => ({
              path: file.path,
              quality: ctx.decision.qualityName(file.quality),
              size: file.size,
            })),
            download: downloads.get(b.id),
          }
          rows.set(b.id, row)
        }
      }
      // newest first, books without a year last
      const key = (r: BookRow) => r.releaseDate ?? (r.year ? `${r.year}` : '')
      return [...rows.values()].sort((a, b) => key(b).localeCompare(key(a)))
    },
    async update(followId, patch) {
      books.update(followId, patch)
    },
    async monitorBook(followId, bookId, monitored) {
      books.monitorBooks(followId, [bookId], monitored)
    },
    async refresh(followId) {
      await books.refresh(follow(followId).id)
    },
    async remove(followId, deleteFiles) {
      books.remove(followId, deleteFiles)
    },
    async search(followId, bookIds) {
      const f = follow(followId)
      const { results, errors } = await books.search(f.id, bookIds, 'interactive')
      const titles = new Map(books.books(f.id).map((b) => [b.id, b.title]))
      return {
        errors,
        results: results.map(({ release: r, decision: d, unitIds: ids }) => ({
          guid: r.guid,
          title: r.title,
          indexer: r.indexerName,
          protocol: r.protocol,
          size: r.size,
          seeders: r.seeders,
          leechers: r.leechers,
          unit: ids.map((id) => titles.get(id)).join(', '),
          quality: ctx.decision.qualityName(d.quality),
          formatScore: d.formatScore,
          matchedFormats: d.matchedFormats,
          accepted: d.accepted,
          rejections: d.rejections.map(({ rule, reason }) => ({ rule, reason })),
        })),
      }
    },
    async grab(followId, guid) {
      await books.grab(followId, guid)
    },
    async searchNow(followId, bookIds) {
      const grabbed = await books.searchAndGrab(followId, bookIds)
      if (grabbed.length) return `Sent ${grabbed.join(', ')} to the download client.`
      if (!bookIds && !books.wantedBooks(followId).length)
        return 'Nothing is missing: every monitored, released book has a file.'
      return 'No acceptable release found. Use "Choose" to see why.'
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/books', '/books/add', '/books/:id'],
    },
    data,
  )
}
