import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import * as itunes from '../src'

let server: Server
let base: string
let lastQuery: URLSearchParams
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/json')
    if (url.pathname !== '/search') return res.writeHead(404).end('{}')
    lastQuery = url.searchParams
    res.end(
      JSON.stringify({
        results: [
          {
            collectionId: 1,
            collectionName: 'Show',
            artistName: 'Host',
            feedUrl: 'https://f/1.xml',
            artworkUrl100: 'https://a/100.jpg',
            artworkUrl600: 'https://a/600.jpg',
            primaryGenreName: 'Comedy',
          },
          { collectionId: 2, collectionName: 'No feed', artworkUrl100: 'https://a/2.jpg' },
          {
            collectionId: 3,
            collectionName: 'Small art',
            feedUrl: 'https://f/3.xml',
            artworkUrl100: 'https://a/3.jpg',
          },
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
  const provider = ctx.metadata.for('podcast')!
  expect(provider.id).toBe('itunes')
  const results = await provider.search({ kind: 'podcast', term: 'show' })
  expect(lastQuery.get('term')).toBe('show')
  expect(lastQuery.get('country')).toBe('GB')
  expect(lastQuery.get('entity')).toBe('podcast')
  expect(results).toEqual([
    {
      kind: 'podcast',
      title: 'Show',
      author: 'Host',
      posterUrl: 'https://a/600.jpg',
      ids: { itunes: '1' },
      feedUrl: 'https://f/1.xml',
      overview: 'Comedy',
    },
    {
      kind: 'podcast',
      title: 'Small art',
      author: undefined,
      posterUrl: 'https://a/3.jpg',
      ids: { itunes: '3' },
      feedUrl: 'https://f/3.xml',
      overview: undefined,
    },
  ])
})
