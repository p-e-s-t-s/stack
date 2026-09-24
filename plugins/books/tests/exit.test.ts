// Phase 4.7 exit: follow an author, and a wanted book is found by a fake Newznab book search,
// then imported as an ebook and as an audiobook into their own folders with the right names —
// through the real indexers, Torznab, decision, downloads, import and calendar plugins.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import CalendarService from '@magpiejs/calendar'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService, { grabs } from '@magpiejs/downloads'
import ImportService from '@magpiejs/import'
import * as torznab from '@magpiejs/indexer-torznab'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import BooksService from '../src'

const requests: Record<string, string>[] = []
let server: Server
let base: string
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (url.searchParams.get('t') === 'caps')
      return res.end(`<caps><searching><search available="yes" supportedParams="q"/>
        <book-search available="yes" supportedParams="q,author,title"/></searching>
        <categories><category id="7000" name="Books"/><category id="3030" name="Audio/Audiobook"/></categories></caps>`)
    requests.push(Object.fromEntries(url.searchParams))
    const item = (title: string, hash: string) =>
      `<item><title>${title}</title><guid>${title}</guid><size>50000000</size>
        <link>magnet:?xt=urn:btih:${hash.repeat(40)}</link><torznab:attr name="seeders" value="9"/></item>`
    res.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
      ${item('Andy.Weir.-.Project.Hail.Mary.2021.RETAIL.EPUB.eBook-GRP', 'a')}
      ${item('Andy Weir - Project Hail Mary (2021) (Unabridged) [MP3] {read by Ray Porter}', 'b')}
      ${item('Andy Weir - Artemis (2017) [EPUB]', 'c')}
    </channel></rss>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('finds a wanted book and imports it as an ebook and as an audiobook', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-books-'))
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(IndexersService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(ImportService)
  await ctx.plugin(CalendarService)
  await ctx.plugin(torznab, { name: 'Books', url: `${base}/api` } as unknown as torznab.Config)
  await ctx.plugin(BooksService)
  ctx.metadata.register({
    id: 'openlibrary',
    kinds: ['ebook', 'audiobook'],
    search: async () => [],
    getAuthor: async (id) => ({ kind: 'ebook', title: 'Andy Weir', ids: { openlibrary: id } }),
    getBooks: async () => [
      { ids: { openlibrary: 'W1' }, title: 'Artemis', year: 2017, releaseDate: '2017-11-14' },
      {
        ids: { openlibrary: 'W2' },
        title: 'Project Hail Mary',
        year: 2021,
        releaseDate: '2021-05-04',
      },
    ],
  })
  // a download client that "finishes" each download with the given files
  const contents: Record<string, Record<string, string>> = {
    ['a'.repeat(40)]: { 'phm.epub': 'epub', 'phm.mobi': 'mobi', 'cover.jpg': 'jpg' },
    ['b'.repeat(40)]: {
      'CD1/01 Chapter.mp3': 'a',
      'CD1/02 Chapter.mp3': 'b',
      'CD2/01 Chapter.mp3': 'c',
    },
  }
  ctx.downloads.register(
    {
      id: 'client',
      protocol: 'torrent',
      add: async (payload) => (payload as { hash: string }).hash,
      list: async () => [],
      remove: async () => {},
      test: async () => ({ ok: true }),
    },
    { name: 'Client', priority: 1, category: 'magpie' },
  )
  const finish = async () => {
    for (const grab of ctx.downloads.active()) {
      const out = join(dir, 'downloads', grab.downloadId!)
      for (const [name, text] of Object.entries(contents[grab.downloadId!]!)) {
        mkdirSync(join(out, name, '..'), { recursive: true })
        writeFileSync(join(out, name), text)
      }
      ctx.downloads.db
        .update(grabs)
        .set({ state: 'import_pending', outputPath: out })
        .where(eq(grabs.id, grab.id))
        .run()
      await ctx.import.importGrab(grab.id)
    }
  }

  // follow the author for both formats, wanting the newest book; searching starts right away
  for (const kind of ['ebook', 'audiobook'] as const) {
    await ctx.books.follow({
      authorId: 'OL1A',
      kind,
      profileId: ctx.decision.profiles(kind)[0]!.id,
      rootFolderId: ctx.library.addRootFolder(join(dir, `${kind}s`), kind).id,
      monitor: 'latest',
    })
  }
  await ctx.jobs.tick()
  await ctx.jobs.tick()

  // a book search by author and title, in each format's categories
  expect(requests.map((r) => [r.t, r.author, r.title, r.cat]).sort()).toEqual([
    ['book', 'Andy Weir', 'Project Hail Mary', '3030'],
    ['book', 'Andy Weir', 'Project Hail Mary', '7000,7020'],
  ])
  expect(
    ctx.downloads
      .active()
      .map((g) => [g.title, g.quality])
      .sort(),
  ).toEqual([
    [
      'Andy Weir - Project Hail Mary (2021) (Unabridged) [MP3] {read by Ray Porter}',
      'audiobook-mp3',
    ],
    ['Andy.Weir.-.Project.Hail.Mary.2021.RETAIL.EPUB.eBook-GRP', 'ebook-epub'],
  ])

  await finish()
  const tree = (root: string) =>
    (readdirSync(root, { recursive: true }) as string[])
      .filter((p) => p.includes('.'))
      .map((p) => relative(root, join(root, p)))
      .sort()
  expect(tree(join(dir, 'ebooks'))).toEqual([
    'Andy Weir/Project Hail Mary (2021)/Andy Weir - Project Hail Mary.epub',
    'Andy Weir/Project Hail Mary (2021)/Andy Weir - Project Hail Mary.mobi',
  ])
  expect(tree(join(dir, 'audiobooks'))).toEqual([
    'Andy Weir/Project Hail Mary (2021)/CD1/01 Chapter.mp3',
    'Andy Weir/Project Hail Mary (2021)/CD1/02 Chapter.mp3',
    'Andy Weir/Project Hail Mary (2021)/CD2/01 Chapter.mp3',
  ])
  for (const follow of ctx.books.list())
    expect(ctx.books.stats(follow.id)).toMatchObject({ wanted: 1, downloaded: 1 })

  // and it's on the calendar, once per format
  expect(
    ctx.calendar
      .entries('2021-05-01', '2021-05-31')
      .map((e) => [e.kind, e.title, e.subtitle, e.state])
      .sort(),
  ).toEqual([
    ['audiobook', 'Andy Weir', 'Project Hail Mary · Audiobook', 'downloaded'],
    ['ebook', 'Andy Weir', 'Project Hail Mary · Ebook', 'downloaded'],
  ])
  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})
