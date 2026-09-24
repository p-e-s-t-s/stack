// @magpiejs/books: ebooks and audiobooks. An author followed in a format is a library item
// (kind `ebook` or `audiobook`, with its own root folder and quality profile); their books are
// its units, like a series' episodes. Author and book metadata come from Open Library and are
// shared by both formats. Searching, downloading and importing are added by the parts of this
// plugin that need those services.

import { rmSync } from 'node:fs'
import type {} from '@cordisjs/plugin-timer'
import type { Drizzle } from '@magpiejs/database'
import { cutoffMet, profileRanks } from '@magpiejs/decision'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import { type MediaFile, type MediaItem, renderName } from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import type { BookMetadata } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, eq, inArray } from 'drizzle-orm'
import api from './api'
import automation from './automation'
import bookCalendar from './calendar'
import { audiobookFamily, ebookFamily } from './families'
import bookImport from './import'
import { BOOK_NAMING } from './naming'
import * as schema from './schema'
import bookSearch, { type BookResult, type BookSearch } from './search'

export * from './families'
export { AUDIOBOOK_EXTENSIONS, EBOOK_EXTENSIONS, fileQuality } from './import'
export * from './match'
export * from './parse'
export * from './schema'
export type { BookResult, BookSearch, FoundRelease } from './search'

declare module '@magpiejs/types' {
  interface MediaKinds {
    ebook: true
    audiobook: true
  }
}

declare module 'cordis' {
  interface Context {
    books: BooksService
  }
  interface Events {
    'books/added'(follow: Follow, options: { search: boolean }): void
    /** An author's books, their monitoring, files or downloads changed. */
    'books/changed'(mediaId: number): void
  }
}

export type BookKind = 'ebook' | 'audiobook'
export const BOOK_KINDS: BookKind[] = ['ebook', 'audiobook']
export const isBookKind = (kind: string): kind is BookKind =>
  kind === 'ebook' || kind === 'audiobook'

export interface FollowStats {
  books: number
  monitored: number
  /** Monitored, released books. */
  wanted: number
  /** Of those, how many have a file. */
  downloaded: number
  nextRelease?: string
}

/** An author followed in one format. */
export interface Follow extends MediaItem {
  kind: BookKind
  author: schema.Author
  details: schema.Followed
  stats: FollowStats
}

/** A book as seen from one format: its monitoring there. */
export interface TrackedBook extends schema.Book {
  monitored: boolean
  lastSearchedAt: number | null
}

export interface FollowOptions {
  /** Open Library author key. */
  authorId: string
  kind: BookKind
  profileId: number
  rootFolderId: number
  monitor?: schema.MonitorOption
  /** Search for the monitored books right away. */
  search?: boolean
}

const DAY = 86_400_000
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/** Out already: a release date on or before today, or only a year that isn't in the future. */
export function isReleased(
  book: { releaseDate: string | null; year: number | null },
  now = Date.now(),
) {
  if (book.releaseDate) return book.releaseDate <= today(now)
  return !!book.year && book.year <= new Date(now).getUTCFullYear()
}

function bookValues(b: BookMetadata) {
  return {
    title: b.title,
    subtitle: b.subtitle ?? null,
    year: b.year ?? null,
    releaseDate: b.releaseDate ?? null,
    coverUrl: b.coverUrl ?? null,
    editions: b.editions ?? null,
  }
}

export class BooksService extends Service {
  static inject = ['database', 'library', 'metadata', 'jobs', 'decision', 'timer']

  db!: Drizzle<typeof schema>
  /** Set while an indexers plugin is loaded. */
  searcher?: BookSearch
  /** Set while a downloads plugin is loaded. */
  grabber?: (mediaId: number, result: BookResult, manual: boolean) => Promise<unknown>

  constructor(ctx: Context) {
    super(ctx, 'books')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'books',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.library.registerKind({ id: 'ebook', label: 'Ebooks' })
    this.ctx.library.registerKind({ id: 'audiobook', label: 'Audiobooks' })
    this.ctx.library.registerNaming('ebook', BOOK_NAMING.ebook)
    this.ctx.library.registerNaming('audiobook', BOOK_NAMING.audiobook)
    this.ctx.decision.family(ebookFamily)
    this.ctx.decision.family(audiobookFamily)
    this.ctx.jobs.define('books.refresh', async (payload: { id?: number }) => {
      const ids = payload?.id
        ? [payload.id]
        : this.db
            .select()
            .from(schema.authors)
            .all()
            .map((a) => a.id)
      for (const id of ids) {
        try {
          await this.refreshAuthor(id)
        } catch (error) {
          this.ctx.logger.warn('could not refresh author %s: %s', id, error)
        }
      }
    })
    this.ctx.jobs.schedule('books.refresh-all', 'books.refresh', DAY)
    this.ctx.inject(['indexers'], (ctx) => void ctx.plugin(bookSearch, this))
    this.ctx.inject(['import'], (ctx) => void ctx.plugin(bookImport, this))
    this.ctx.inject(['indexers', 'downloads'], (ctx) => void ctx.plugin(automation, this))
    this.ctx.inject(['calendar'], (ctx) => void ctx.plugin(bookCalendar, this))
    this.ctx.inject(['api'], (ctx) => void ctx.plugin(api, this))
    this.ctx.inject(['downloads'], (ctx) => {
      ctx.effect(() => {
        this.grabber = async (mediaId, { release, decision, bookIds }, manual) => {
          const grab = await ctx.downloads.grab(mediaId, release, {
            quality: decision.quality,
            formatScore: decision.formatScore,
            manual,
          })
          if (bookIds.length)
            this.db
              .insert(schema.grabBooks)
              .values(bookIds.map((bookId) => ({ grabId: grab.id, bookId })))
              .run()
          this.ctx.emit('books/changed', mediaId)
          return grab
        }
        return () => (this.grabber = undefined)
      }, 'books.grabber')

      // a release isn't wanted while an equal or better one of the book is downloading
      ctx.decision.rule('book-in-queue', ({ target, qualityRank, formatScore, rankOf }) => {
        if (target.kind !== 'book' || !target.mediaId || !target.unitIds?.length) return
        for (const grab of this.activeGrabs(target.mediaId)) {
          if (!grab.bookIds.some((id) => target.unitIds!.includes(id))) continue
          const rank = rankOf(grab.quality)
          if (rank > qualityRank || (rank === qualityRank && grab.formatScore >= formatScore))
            return `already downloading ${grab.title}`
        }
      })
      for (const event of ['downloads/grabbed', 'downloads/updated'] as const)
        ctx.on(event, (grab) => {
          if (this.get(grab.mediaId)) this.ctx.emit('books/changed', grab.mediaId)
        })
    })
  }

  provider() {
    const provider = this.ctx.get('metadata')?.for('ebook', 'openlibrary')
    if (!provider?.getAuthor || !provider.getBooks)
      throw new Error('no book metadata provider is enabled (add Open Library in Settings)')
    return provider
  }

  // ---- finding and following authors

  /** Searches for authors; results carry the library ids of formats already followed. */
  async lookup(term: string) {
    const results = await this.provider().search({ term, kind: 'ebook' })
    const follows = this.list()
    return results.map((r) => ({
      ...r,
      followed: Object.fromEntries(
        follows
          .filter((f) => f.author.openlibraryId === r.ids.openlibrary)
          .map((f) => [f.kind, f.id]),
      ) as Partial<Record<BookKind, number>>,
    }))
  }

  /** The shared author row, created (with its books) on first use. */
  private async author(openlibraryId: string) {
    const found = this.db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.openlibraryId, openlibraryId))
      .get()
    if (found) return found
    const provider = this.provider()
    const [meta, books] = await Promise.all([
      provider.getAuthor!(openlibraryId),
      provider.getBooks!(openlibraryId),
    ])
    return this.db.transaction((tx) => {
      const author = tx
        .insert(schema.authors)
        .values({
          openlibraryId,
          name: meta.title,
          overview: meta.overview ?? null,
          photoUrl: meta.posterUrl ?? null,
          alternateNames: meta.alternateNames ?? [],
          refreshedAt: Date.now(),
        })
        .returning()
        .get()
      for (const b of books)
        tx.insert(schema.books)
          .values({ authorId: author.id, openlibraryId: b.ids.openlibrary!, ...bookValues(b) })
          .onConflictDoNothing()
          .run()
      return author
    })
  }

  /** Follows an author in one format. */
  async follow(options: FollowOptions): Promise<Follow> {
    const family = this.ctx.decision.profile(options.profileId)?.family
    if (family !== options.kind)
      throw new Error(
        `choose ${options.kind === 'ebook' ? 'an ebook' : 'an audiobook'} quality profile`,
      )
    const author = await this.author(options.authorId)
    if (this.list(options.kind).some((f) => f.author.id === author.id))
      throw new Error(`${author.name} is already followed for ${options.kind}s`)
    const monitor = options.monitor ?? 'all'
    const naming = this.ctx.library.naming(options.kind)
    const item = this.ctx.library.add(
      {
        kind: options.kind,
        title: author.name,
        overview: author.overview,
        posterUrl: author.photoUrl,
        monitored: monitor !== 'none',
        externalIds: { openlibrary: author.openlibraryId },
        primaryProvider: 'openlibrary',
        profileId: options.profileId,
        rootFolderId: options.rootFolderId,
        folder: renderName(naming.authorFolder!, { 'Author Name': author.name }),
        refreshedAt: Date.now(),
      },
      author.alternateNames,
    )
    const books = this.authorBooks(author.id)
    const released = books.filter((b) => isReleased(b)).sort(byRelease)
    const latest = released.at(-1)?.id
    const monitored = (b: schema.Book) =>
      monitor === 'all' ||
      (monitor === 'future' && !isReleased(b)) ||
      (monitor === 'latest' && (b.id === latest || !isReleased(b)))
    this.db.transaction((tx) => {
      tx.insert(schema.followed)
        .values({ mediaId: item.id, authorId: author.id, monitorNew: monitor !== 'none' })
        .run()
      for (const b of books)
        tx.insert(schema.monitoring)
          .values({ mediaId: item.id, bookId: b.id, monitored: monitored(b) })
          .run()
    })
    const follow = this.get(item.id)!
    this.ctx.emit('books/added', follow, { search: options.search ?? true })
    return follow
  }

  /** Updates an author and their books from the provider, for every format they're followed in. */
  async refreshAuthor(authorId: number) {
    const author = this.db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.id, authorId))
      .get()
    if (!author) return
    const provider = this.provider()
    const [meta, fresh] = await Promise.all([
      provider.getAuthor!(author.openlibraryId),
      provider.getBooks!(author.openlibraryId),
    ])
    const follows = this.db
      .select()
      .from(schema.followed)
      .where(eq(schema.followed.authorId, authorId))
      .all()
    this.db.transaction((tx) => {
      tx.update(schema.authors)
        .set({
          name: meta.title,
          overview: meta.overview ?? null,
          photoUrl: meta.posterUrl ?? null,
          alternateNames: meta.alternateNames ?? [],
          refreshedAt: Date.now(),
        })
        .where(eq(schema.authors.id, authorId))
        .run()
      const known = new Map(this.authorBooks(authorId).map((b) => [b.openlibraryId, b]))
      for (const b of fresh) {
        const old = known.get(b.ids.openlibrary!)
        if (old) {
          tx.update(schema.books).set(bookValues(b)).where(eq(schema.books.id, old.id)).run()
          continue
        }
        const row = tx
          .insert(schema.books)
          .values({ authorId, openlibraryId: b.ids.openlibrary!, ...bookValues(b) })
          .returning()
          .get()
        for (const f of follows) {
          const item = this.ctx.library.get(f.mediaId)
          tx.insert(schema.monitoring)
            .values({
              mediaId: f.mediaId,
              bookId: row.id,
              monitored: f.monitorNew && !!item?.monitored,
            })
            .run()
        }
      }
      // books the provider dropped go too, unless they have files
      const dropped = new Set(fresh.map((b) => b.ids.openlibrary))
      const withFiles = new Set(
        tx
          .select()
          .from(schema.bookFiles)
          .all()
          .map((f) => f.bookId),
      )
      const gone = [...known.values()]
        .filter((b) => !dropped.has(b.openlibraryId) && !withFiles.has(b.id))
        .map((b) => b.id)
      if (gone.length) tx.delete(schema.books).where(inArray(schema.books.id, gone)).run()
    })
    for (const f of follows) {
      this.ctx.library.update(
        f.mediaId,
        {
          title: meta.title,
          overview: meta.overview ?? null,
          posterUrl: meta.posterUrl ?? null,
          refreshedAt: Date.now(),
        },
        meta.alternateNames,
      )
      this.ctx.emit('books/changed', f.mediaId)
    }
  }

  /** Refreshes the author behind a library item. */
  refresh(mediaId: number) {
    const follow = this.get(mediaId)
    return follow && this.refreshAuthor(follow.author.id)
  }

  // ---- reading

  get(mediaId: number): Follow | undefined {
    const item = this.ctx.library.get(mediaId)
    if (!item || !isBookKind(item.kind)) return
    const details = this.db
      .select()
      .from(schema.followed)
      .where(eq(schema.followed.mediaId, mediaId))
      .get()
    if (!details) return
    return this.assemble(item, details)
  }

  list(kind?: BookKind): Follow[] {
    const details = new Map(
      this.db
        .select()
        .from(schema.followed)
        .all()
        .map((d) => [d.mediaId, d]),
    )
    return (kind ? [kind] : BOOK_KINDS)
      .flatMap((k) => this.ctx.library.list(k))
      .filter((item) => details.has(item.id))
      .map((item) => this.assemble(item, details.get(item.id)!))
  }

  private assemble(item: MediaItem, details: schema.Followed): Follow {
    const author = this.db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.id, details.authorId))
      .get()!
    return { ...item, kind: item.kind as BookKind, author, details, stats: this.stats(item.id) }
  }

  stats(mediaId: number, now = Date.now()): FollowStats {
    const books = this.books(mediaId)
    const files = this.bookFiles(mediaId)
    const wanted = books.filter((b) => b.monitored && isReleased(b, now))
    const upcoming = books
      .filter((b) => b.monitored && b.releaseDate && b.releaseDate > today(now))
      .map((b) => b.releaseDate!)
      .sort()
    return {
      books: books.length,
      monitored: books.filter((b) => b.monitored).length,
      wanted: wanted.length,
      downloaded: wanted.filter((b) => files.has(b.id)).length,
      nextRelease: upcoming[0],
    }
  }

  private authorBooks(authorId: number) {
    return this.db.select().from(schema.books).where(eq(schema.books.authorId, authorId)).all()
  }

  /** The author's books with their monitoring in this format, newest first. */
  books(mediaId: number): TrackedBook[] {
    return this.db
      .select()
      .from(schema.monitoring)
      .innerJoin(schema.books, eq(schema.books.id, schema.monitoring.bookId))
      .where(eq(schema.monitoring.mediaId, mediaId))
      .all()
      .map(({ books_books: book, books_monitoring: m }) => ({
        ...book,
        monitored: m.monitored,
        lastSearchedAt: m.lastSearchedAt,
      }))
      .sort((a, b) => byRelease(b, a))
  }

  book(id: number) {
    return this.db.select().from(schema.books).where(eq(schema.books.id, id)).get()
  }

  /** Files of a library item by book id (an audiobook may have several). */
  bookFiles(mediaId: number): Map<number, MediaFile[]> {
    const files = new Map(this.ctx.library.files(mediaId).map((f) => [f.id, f]))
    const result = new Map<number, MediaFile[]>()
    if (!files.size) return result
    for (const link of this.db
      .select()
      .from(schema.bookFiles)
      .where(inArray(schema.bookFiles.fileId, [...files.keys()]))
      .all())
      result.set(link.bookId, [...(result.get(link.bookId) ?? []), files.get(link.fileId)!])
    return result
  }

  /** Records that library files hold a book. */
  linkFiles(fileIds: number[], bookId: number) {
    if (!fileIds.length) return
    this.db
      .insert(schema.bookFiles)
      .values(fileIds.map((fileId) => ({ fileId, bookId })))
      .onConflictDoUpdate({ target: schema.bookFiles.fileId, set: { bookId } })
      .run()
  }

  /** Monitored, released books without a file, or below the profile's cutoff. */
  wantedBooks(mediaId: number, now = Date.now()) {
    const follow = this.get(mediaId)
    if (!follow) return []
    const files = this.bookFiles(mediaId)
    const profile = this.ctx.decision.profile(follow.profileId)
    const rankOf = profile ? profileRanks(profile).rankOf : () => 0
    return this.books(mediaId).filter((b) => {
      if (!b.monitored || !isReleased(b, now)) return false
      const best = files.get(b.id)?.sort((x, y) => rankOf(y.quality) - rankOf(x.quality))[0]
      return !best || (!!profile && !cutoffMet(profile, best))
    })
  }

  /** Downloads in progress for a library item, with the books each is. */
  activeGrabs(mediaId: number) {
    const active =
      this.ctx
        .get('downloads')
        ?.active()
        .filter((g) => g.mediaId === mediaId) ?? []
    if (!active.length) return []
    const links = this.db
      .select()
      .from(schema.grabBooks)
      .where(
        inArray(
          schema.grabBooks.grabId,
          active.map((g) => g.id),
        ),
      )
      .all()
    return active.map((grab) => ({
      ...grab,
      bookIds: links.filter((l) => l.grabId === grab.id).map((l) => l.bookId),
    }))
  }

  /** Books a grab is. */
  grabBooks(grabId: number) {
    return this.db
      .select()
      .from(schema.grabBooks)
      .where(eq(schema.grabBooks.grabId, grabId))
      .all()
      .map((l) => l.bookId)
  }

  // ---- changing

  update(
    mediaId: number,
    patch: { profileId?: number; monitored?: boolean; monitorNew?: boolean },
  ) {
    const { monitorNew, ...itemPatch } = patch
    if (monitorNew !== undefined)
      this.db
        .update(schema.followed)
        .set({ monitorNew })
        .where(eq(schema.followed.mediaId, mediaId))
        .run()
    if (itemPatch.profileId !== undefined) {
      const follow = this.get(mediaId)
      if (follow && this.ctx.decision.profile(itemPatch.profileId)?.family !== follow.kind)
        throw new Error(
          `choose ${follow.kind === 'ebook' ? 'an ebook' : 'an audiobook'} quality profile`,
        )
    }
    this.ctx.library.update(mediaId, itemPatch)
    this.ctx.emit('books/changed', mediaId)
    return this.get(mediaId)
  }

  monitorBooks(mediaId: number, bookIds: number[], monitored: boolean) {
    if (!bookIds.length) return
    this.db
      .update(schema.monitoring)
      .set({ monitored })
      .where(
        and(eq(schema.monitoring.mediaId, mediaId), inArray(schema.monitoring.bookId, bookIds)),
      )
      .run()
    this.ctx.emit('books/changed', mediaId)
  }

  markSearched(mediaId: number, bookIds: number[], now = Date.now()) {
    if (!bookIds.length) return
    this.db
      .update(schema.monitoring)
      .set({ lastSearchedAt: now })
      .where(
        and(eq(schema.monitoring.mediaId, mediaId), inArray(schema.monitoring.bookId, bookIds)),
      )
      .run()
  }

  /** Stops following an author in one format; the author goes when no format is left. */
  remove(mediaId: number, deleteFiles = false) {
    const follow = this.get(mediaId)
    if (!follow) return
    if (deleteFiles) rmSync(this.ctx.library.folderOf(follow), { recursive: true, force: true })
    this.ctx.library.remove(mediaId)
    const others = this.db
      .select()
      .from(schema.followed)
      .where(eq(schema.followed.authorId, follow.author.id))
      .all()
    if (!others.length)
      this.db.delete(schema.authors).where(eq(schema.authors.id, follow.author.id)).run()
  }

  // ---- searching and grabbing

  /** Searches indexers for books; throws if no indexers plugin is loaded. */
  search(mediaId: number, bookIds: number[], kind: 'automatic' | 'interactive' = 'automatic') {
    if (!this.searcher) throw new Error('no indexers are enabled')
    return this.searcher.search(mediaId, bookIds, kind)
  }

  /** Grabs a release from the last search of an author (interactive "Download"). */
  async grab(mediaId: number, guid: string) {
    const result = this.searcher?.cached(mediaId, guid)
    if (!result) throw new Error('search results expired; search again')
    if (!this.grabber) throw new Error('no download clients are enabled')
    return this.grabber(mediaId, result, true)
  }

  /** Searches for books (the wanted ones when not given) and grabs the best release of each. */
  async searchAndGrab(mediaId: number, bookIds?: number[]) {
    if (!this.grabber) throw new Error('set up a download client first')
    const ids = bookIds ?? this.wantedBooks(mediaId).map((b) => b.id)
    if (!ids.length) return []
    const { results } = await this.search(mediaId, ids)
    const grabbed: string[] = []
    for (const result of pickReleases(results, new Set(ids))) {
      await this.grabber(mediaId, result, false)
      grabbed.push(result.release.title)
    }
    return grabbed
  }
}

/** Oldest first: by release date, else by year. */
function byRelease(a: schema.Book, b: schema.Book) {
  const key = (x: schema.Book) => x.releaseDate ?? (x.year ? `${x.year}-99` : '9999')
  return key(a).localeCompare(key(b)) || a.id - b.id
}

/** The best accepted release of each wanted book. */
export function pickReleases(results: BookResult[], wanted: Set<number>) {
  const picked: BookResult[] = []
  const covered = new Set<number>()
  for (const r of results) {
    if (!r.decision.accepted) continue
    if (!r.bookIds.some((id) => wanted.has(id)) || r.bookIds.some((id) => covered.has(id))) continue
    picked.push(r)
    for (const id of r.bookIds) covered.add(id)
  }
  return picked
}

export default BooksService
