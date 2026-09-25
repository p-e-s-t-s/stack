// Phase 4.7 exit: follow an author, and a wanted book is found by a fake Newznab book search,
// then imported as an ebook and as an audiobook into their own folders with the right names —
// through the real indexers, Torznab, decision, downloads, import and calendar plugins.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import * as torznab from '@magpiejs/indexer-torznab'
import {
  createTestContext,
  fakeDownloadClient,
  fakeTorznab,
  finishDownloads,
} from '@magpiejs/testing'
import { afterAll, expect, it } from 'vitest'
import BooksService from '../src'

const fake = await fakeTorznab({
  caps: {
    book: ['q', 'author', 'title'],
    categories: [
      { id: 7000, name: 'Books' },
      { id: 3030, name: 'Audio/Audiobook' },
    ],
  },
  items: () => [
    {
      title: 'Andy.Weir.-.Project.Hail.Mary.2021.RETAIL.EPUB.eBook-GRP',
      hash: 'a'.repeat(40),
      size: 50_000_000,
      seeders: 9,
    },
    {
      title: 'Andy Weir - Project Hail Mary (2021) (Unabridged) [MP3] {read by Ray Porter}',
      hash: 'b'.repeat(40),
      size: 50_000_000,
      seeders: 9,
    },
    {
      title: 'Andy Weir - Artemis (2017) [EPUB]',
      hash: 'c'.repeat(40),
      size: 50_000_000,
      seeders: 9,
    },
  ],
})
afterAll(() => fake.close())

it('finds a wanted book and imports it as an ebook and as an audiobook', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-books-'))
  const ctx = await createTestContext()
  await ctx.plugin(torznab, { name: 'Books', url: `${fake.url}/api` } as unknown as torznab.Config)
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
  const client = fakeDownloadClient()
  ctx.downloads.register(client.client, { name: 'Client', priority: 1, category: 'magpie' })
  const finish = () =>
    finishDownloads(ctx, {
      dir: join(dir, 'downloads'),
      folderName: (grab) => grab.downloadId!,
      files: (grab) => contents[grab.downloadId!],
    })

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
  expect(
    fake.requests.map((r) => [r.get('t'), r.get('author'), r.get('title'), r.get('cat')]).sort(),
  ).toEqual([
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
