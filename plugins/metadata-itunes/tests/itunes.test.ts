import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import * as itunes from '../src'

let server: Server
let base: string
let lastParams: URLSearchParams

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    lastParams = url.searchParams
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        results: [
          {
            collectionId: 1,
            collectionName: 'With Feed',
            artistName: 'Host',
            feedUrl: 'https://feed.example/1.xml',
            artworkUrl600: 'https://img/600.jpg',
            artworkUrl100: 'https://img/100.jpg',
            primaryGenreName: 'Technology',
          },
          {
            collectionId: 2,
            collectionName: 'Small Art Only',
            feedUrl: 'https://feed.example/2.xml',
            artworkUrl100: 'https://img/100b.jpg',
          },
          // a podcast without a public feed cannot be followed
          { collectionId: 3, collectionName: 'No Feed', artworkUrl600: 'https://img/x.jpg' },
        ],
      }),
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('searches podcasts in the configured store and drops those without a feed', async () => {
  const ctx = new Context()
  await ctx.plugin(HTTP)
  await ctx.plugin(MetadataService)
  await ctx.plugin(itunes, { country: 'GB', baseUrl: base })
  const provider = ctx.metadata.get('itunes')!
  expect(provider.kinds).toEqual(['podcast'])

  const results = await provider.search({ kind: 'podcast', term: 'syntax' })
  expect(Object.fromEntries(lastParams)).toMatchObject({
    media: 'podcast',
    entity: 'podcast',
    term: 'syntax',
    country: 'GB',
  })
  expect(results).toEqual([
    {
      kind: 'podcast',
      title: 'With Feed',
      author: 'Host',
      posterUrl: 'https://img/600.jpg',
      ids: { itunes: '1' },
      feedUrl: 'https://feed.example/1.xml',
      overview: 'Technology',
    },
    {
      kind: 'podcast',
      title: 'Small Art Only',
      author: undefined,
      posterUrl: 'https://img/100b.jpg',
      ids: { itunes: '2' },
      feedUrl: 'https://feed.example/2.xml',
      overview: undefined,
    },
  ])
})
