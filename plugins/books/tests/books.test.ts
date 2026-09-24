import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import * as torznab from '@magpiejs/indexer-torznab'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import type { BookMetadata } from '@magpiejs/types'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import BooksService from '../src'

const books: BookMetadata[] = [
  { ids: { openlibrary: 'W1' }, title: 'The Martian', year: 2011, releaseDate: '2011-09-27' },
  { ids: { openlibrary: 'W2' }, title: 'Artemis', year: 2017, releaseDate: '2017-11-14' },
  { ids: { openlibrary: 'W3' }, title: 'Project Hail Mary', year: 2021, releaseDate: '2021-05-04' },
]

let server: Server
let base: string
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (url.searchParams.get('t') === 'caps')
      return res.end(`<caps><searching><search available="yes" supportedParams="q"/>
        <book-search available="yes" supportedParams="q,author,title"/></searching>
        <categories><category id="7000" name="Books"/></categories></caps>`)
    const item = (title: string, n: number) =>
      `<item><title>${title}</title><guid>${title}</guid><size>${n * 1_000_000}</size>
        <link>magnet:?xt=urn:btih:${String(n).repeat(40)}</link><torznab:attr name="seeders" value="5"/></item>`
    res.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
      ${item('Andy Weir - Artemis (2017) [MOBI]', 1)}
      ${item('Andy.Weir.-.Artemis.2017.RETAIL.EPUB.eBook-GRP', 2)}
      ${item('Andy Weir - Artemis (Unabridged) [M4B]', 3)}
      ${item('Andy Weir - The Martian [EPUB]', 4)}
      ${item('Brian Weir - Artemis [EPUB]', 5)}
    </channel></rss>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('follows an author per format, shares their books, and finds the wanted ones', async () => {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(IndexersService)
  await ctx.plugin(torznab, { name: 'Books', url: `${base}/api` } as unknown as torznab.Config)
  await ctx.plugin(BooksService)
  ctx.metadata.register({
    id: 'openlibrary',
    kinds: ['ebook', 'audiobook'],
    search: async () => [],
    getAuthor: async (id) => ({ kind: 'ebook', title: 'Andy Weir', ids: { openlibrary: id } }),
    getBooks: async () => books,
  })
  const profile = (family: string) => ctx.decision.profiles(family)[0]!.id
  const folder = (kind: 'ebook' | 'audiobook') => ctx.library.addRootFolder(`/${kind}s`, kind).id

  // ebooks: only the newest book; a video profile is refused
  await expect(
    ctx.books.follow({
      authorId: 'A1',
      kind: 'ebook',
      profileId: profile('video'),
      rootFolderId: folder('ebook'),
    }),
  ).rejects.toThrow('choose an ebook quality profile')
  const ebooks = await ctx.books.follow({
    authorId: 'A1',
    kind: 'ebook',
    profileId: profile('ebook'),
    rootFolderId: ctx.library.rootFolders('ebook')[0]!.id,
    monitor: 'latest',
    search: false,
  })
  expect(ctx.books.books(ebooks.id).map((b) => [b.title, b.monitored])).toEqual([
    ['Project Hail Mary', true],
    ['Artemis', false],
    ['The Martian', false],
  ])
  // audiobooks of the same author share the books, with their own monitoring
  const audio = await ctx.books.follow({
    authorId: 'A1',
    kind: 'audiobook',
    profileId: profile('audiobook'),
    rootFolderId: folder('audiobook'),
    search: false,
  })
  expect(audio.author.id).toBe(ebooks.author.id)
  expect(ctx.books.wantedBooks(audio.id)).toHaveLength(3)

  // a new book shows up on refresh, monitored where new books are
  books.push({
    ids: { openlibrary: 'W4' },
    title: 'The Next One',
    year: 2099,
    releaseDate: '2099-01-02',
  })
  await ctx.books.refresh(ebooks.id)
  expect(ctx.books.books(ebooks.id)[0]).toMatchObject({ title: 'The Next One', monitored: true })
  expect(ctx.books.stats(ebooks.id)).toMatchObject({
    books: 4,
    wanted: 1,
    nextRelease: '2099-01-02',
  })

  // searching for Artemis: the EPUB wins; other books, authors and formats are rejected
  ctx.books.monitorBooks(
    ebooks.id,
    [ctx.books.books(ebooks.id).find((b) => b.title === 'Artemis')!.id],
    true,
  )
  const artemis = ctx.books.books(ebooks.id).find((b) => b.title === 'Artemis')!
  const { results } = await ctx.books.search(ebooks.id, [artemis.id], 'interactive')
  const reasons = (title: string) =>
    results.find((r) => r.release.title === title)!.decision.rejections.map((x) => x.reason)
  expect(
    results.filter((r) => r.decision.accepted).map((r) => [r.release.title, r.decision.quality]),
  ).toEqual([
    ['Andy.Weir.-.Artemis.2017.RETAIL.EPUB.eBook-GRP', 'ebook-epub'],
    ['Andy Weir - Artemis (2017) [MOBI]', 'ebook-mobi'],
  ])
  expect(reasons('Andy Weir - Artemis (Unabridged) [M4B]')).toContain('is an audiobook')
  expect(reasons('Andy Weir - The Martian [EPUB]')).toContain("is The Martian, which isn't wanted")
  expect(reasons('Brian Weir - Artemis [EPUB]')).toContain('is not a book by Andy Weir')

  // unfollowing one format keeps the author for the other; the last one takes them along
  ctx.books.remove(ebooks.id)
  expect(ctx.books.get(audio.id)!.author.name).toBe('Andy Weir')
  ctx.books.remove(audio.id)
  expect(
    ctx.books.db
      .select()
      .from((await import('../src/schema')).authors)
      .all(),
  ).toEqual([])
})
