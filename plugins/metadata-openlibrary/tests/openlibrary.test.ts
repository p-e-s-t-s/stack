import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import * as openlibrary from '../src'
import { parsePublishDate } from '../src'

const WORKS = [
  {
    key: '/works/OL1W',
    title: 'The Martian',
    first_publish_year: 2011,
    edition_count: 74,
    language: ['fre', 'eng'],
    author_key: ['OL1A'],
    cover_i: 7,
    publish_date: ['2014', 'Feb 11, 2014', 'Sep 27, 2011', 'Jan 01, 2011'],
  },
  {
    key: '/works/OL2W',
    title: 'Artemis',
    first_publish_year: 2017,
    edition_count: 34,
    language: ['eng'],
    author_key: ['OL1A'],
    publish_date: ['November 14th 2017', '2019'],
  },
  // an anthology they contributed to, an omnibus, a translation, a stub and a title in another script
  {
    key: '/works/OL3W',
    title: 'Stories',
    edition_count: 1,
    language: ['eng'],
    author_key: ['OL9A', 'OL1A'],
  },
  {
    key: '/works/OL4W',
    title: 'The Martian / Artemis',
    edition_count: 1,
    language: ['eng'],
    author_key: ['OL1A'],
  },
  {
    key: '/works/OL5W',
    title: 'Der Marsianer',
    edition_count: 3,
    language: ['ger'],
    author_key: ['OL1A'],
  },
  { key: '/works/OL6W', title: 'Lacero', edition_count: 0, author_key: ['OL1A'] },
  { key: '/works/OL7W', title: '아르테미스', edition_count: 1, author_key: ['OL1A'] },
  {
    key: '/works/OL8W',
    title: 'Randomize',
    first_publish_year: 2019,
    edition_count: 1,
    author_key: ['OL1A'],
  },
]

let server: Server
let base: string
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/search.json')
      return res.end(JSON.stringify({ docs: WORKS, numFound: WORKS.length }))
    res.writeHead(404).end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it("lists an author's own books in one language, with first publication dates", async () => {
  const ctx = new Context()
  await ctx.plugin(HTTP)
  await ctx.plugin(MetadataService)
  await ctx.plugin(openlibrary, { language: 'eng', baseUrl: base, coversUrl: 'https://c' })
  const books = await ctx.metadata.get('openlibrary')!.getBooks!('OL1A')
  expect(books.map((b) => [b.title, b.year, b.releaseDate])).toEqual([
    ['The Martian', 2011, '2011-09-27'], // not the 1 January placeholder
    ['Artemis', 2017, '2017-11-14'],
    ['Randomize', 2019, undefined],
  ])
  expect(books[0]).toMatchObject({
    ids: { openlibrary: 'OL1W' },
    coverUrl: 'https://c/b/id/7-L.jpg',
  })
  expect(['15.03.2023', '2021-05-04', '4 Mar. 2020', '2019', 'n.d.'].map(parsePublishDate)).toEqual(
    ['2023-03-15', '2021-05-04', '2020-03-04', undefined, undefined],
  )
})
