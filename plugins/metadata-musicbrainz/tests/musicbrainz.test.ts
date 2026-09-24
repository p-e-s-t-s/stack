import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import * as musicbrainz from '../src'

const credit = (id: string) => [{ artist: { id, name: id } }]
const media = (format: string, count: number) => ({
  position: 1,
  format,
  'track-count': count,
  tracks: Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    number: String(i + 1),
    title: `Track ${i + 1}`,
    length: 200_000 + i,
  })),
})

let busy = 1
let server: Server
let base: string
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/json')
    // MusicBrainz turns requests away when it's busy
    if (busy-- > 0) return res.writeHead(503).end('{"error":"busy"}')
    if (url.pathname === '/release-group') {
      const offset = Number(url.searchParams.get('offset'))
      const groups = [
        {
          id: 'g1',
          title: 'First',
          'primary-type': 'Album',
          'first-release-date': '2001-02-03',
          'artist-credit': credit('A1'),
        },
        { id: 'g2', title: 'Split', 'primary-type': 'Single', 'artist-credit': credit('A2') },
      ]
      return res.end(
        JSON.stringify({
          'release-group-count': 101,
          'release-groups': offset
            ? [
                {
                  id: 'g3',
                  title: 'Live',
                  'primary-type': 'Album',
                  'secondary-types': ['Live'],
                  'artist-credit': credit('A1'),
                },
              ]
            : groups,
        }),
      )
    }
    if (url.pathname === '/release')
      return res.end(
        JSON.stringify({
          releases: [
            { id: 'deluxe', status: 'Official', date: '2001-02-03', media: [media('CD', 12)] },
            {
              id: 'vinyl',
              status: 'Official',
              date: '2001-01-01',
              media: [media('12" Vinyl', 10)],
            },
            { id: 'cd', status: 'Official', date: '2001-02-03', media: [media('CD', 10)] },
            {
              id: 'digital',
              status: 'Official',
              date: '2005-01-01',
              media: [media('Digital Media', 10)],
            },
            { id: 'boot', status: 'Bootleg', date: '2000-01-01', media: [media('CD', 10)] },
          ],
        }),
      )
    res.writeHead(404).end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it("lists an artist's own release groups, and takes track lists from the standard edition", async () => {
  const ctx = new Context()
  await ctx.plugin(HTTP)
  await ctx.plugin(MetadataService)
  await ctx.plugin(musicbrainz, { baseUrl: base, coversUrl: 'https://caa', interval: 1 })
  const provider = ctx.metadata.get('musicbrainz')!
  const albums = await provider.getAlbums!('A1')
  expect(albums.map((a) => [a.title, a.primaryType, a.secondaryTypes, a.releaseDate])).toEqual([
    ['First', 'Album', [], '2001-02-03'],
    ['Live', 'Album', ['Live'], undefined],
  ])
  expect(albums[0]!.coverUrl).toBe('https://caa/release-group/g1/front-250')
  // most common track count, then digital before CD before vinyl
  const tracks = await provider.getTracks!('g1')
  expect(tracks.releaseId).toBe('digital')
  expect(tracks.discs[0]!.tracks[1]).toEqual({ number: 2, title: 'Track 2', lengthMs: 200_001 })
})
