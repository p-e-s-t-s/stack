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
import type { AlbumMetadata } from '@magpiejs/types'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import MusicService from '../src'

const album = (
  id: string,
  title: string,
  primaryType: string,
  releaseDate: string,
  secondaryTypes: string[] = [],
): AlbumMetadata => ({
  ids: { musicbrainz: id },
  title,
  primaryType,
  secondaryTypes,
  releaseDate,
})
const albums = [
  album('g1', 'Pablo Honey', 'Album', '1993-02-22'),
  album('g2', 'The Bends', 'Album', '1995-03-13'),
  album('g3', 'Creep', 'Single', '1992-09-21'),
  album('g4', 'I Might Be Wrong', 'Album', '2001-11-12', ['Live']),
  album('g5', 'My Iron Lung', 'EP', '1994-09-26'),
]
let trackRequests = 0

let server: Server
let base: string
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (url.searchParams.get('t') === 'caps')
      return res.end(`<caps><searching><search available="yes" supportedParams="q"/>
        <music-search available="yes" supportedParams="q,artist,album"/></searching>
        <categories><category id="3000" name="Audio"/></categories></caps>`)
    const item = (title: string, mb: number) =>
      `<item><title>${title}</title><guid>${title}</guid><size>${mb * 1_000_000}</size>
        <link>magnet:?xt=urn:btih:${String(mb % 10).repeat(40)}</link><torznab:attr name="seeders" value="5"/></item>`
    res.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
      ${item('Radiohead - The Bends (1995) [FLAC]', 300)}
      ${item('Radiohead - The Bends (1995) [FLAC 24-96]', 20)}
      ${item('Radiohead-The_Bends-WEB-1995-GRP', 90)}
      ${item('Radiohead - Pablo Honey [FLAC]', 301)}
      ${item('Radiohead Tribute - The Bends [FLAC]', 302)}
    </channel></rss>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('adds an artist, wants albums of chosen types, and finds them', async () => {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(IndexersService)
  await ctx.plugin(torznab, { name: 'Music', url: `${base}/api` } as unknown as torznab.Config)
  await ctx.plugin(MusicService)
  ctx.metadata.register({
    id: 'musicbrainz',
    kinds: ['music'],
    search: async () => [],
    getArtist: async (id) => ({ kind: 'music', title: 'Radiohead', ids: { musicbrainz: id } }),
    getAlbums: async () => albums,
    getTracks: async () => {
      trackRequests++
      // 12 tracks of 4 minutes: 48 minutes
      return {
        releaseId: 'r1',
        discs: [
          {
            number: 1,
            tracks: Array.from({ length: 12 }, (_, i) => ({
              number: i + 1,
              title: `Song ${i + 1}`,
              lengthMs: 240_000,
            })),
          },
        ],
      }
    },
  })
  const profileId = ctx.decision.profiles('audio').find((p) => p.name === 'Any audio')!.id
  const artist = await ctx.music.add({
    artistId: 'A1',
    profileId,
    rootFolderId: ctx.library.addRootFolder('/music', 'music').id,
    search: false,
  })
  // studio albums and EPs by default: not the single or the live album
  expect(ctx.music.albums(artist.id).map((a) => [a.title, a.monitored])).toEqual([
    ['I Might Be Wrong', false],
    ['The Bends', true],
    ['My Iron Lung', true],
    ['Pablo Honey', true],
    ['Creep', false],
  ])
  expect(trackRequests).toBe(0) // track lists are fetched when needed

  // a new album shows up on refresh, monitored when it's of a wanted type
  albums.push(album('g6', 'OK Computer', 'Album', '1997-05-21'))
  await ctx.music.refresh(artist.id)
  expect(ctx.music.albums(artist.id).find((a) => a.title === 'OK Computer')!.monitored).toBe(true)

  // searching for The Bends: FLAC wins; too small for 48 minutes, other albums and artists don't
  const bends = ctx.music.albums(artist.id).find((a) => a.title === 'The Bends')!
  const { results } = await ctx.music.search(artist.id, [bends.id], 'interactive')
  expect(trackRequests).toBe(1)
  expect(
    results.filter((r) => r.decision.accepted).map((r) => [r.release.title, r.decision.quality]),
  ).toEqual([
    ['Radiohead - The Bends (1995) [FLAC]', 'flac'],
    ['Radiohead-The_Bends-WEB-1995-GRP', 'mp3'],
  ])
  const reasons = (title: string) =>
    results
      .find((r) => r.release.title === title)!
      .decision.rejections.map((x) => x.reason)
      .join(' · ')
  expect(reasons('Radiohead - The Bends (1995) [FLAC 24-96]')).toMatch(/too small/)
  expect(reasons('Radiohead - Pablo Honey [FLAC]')).toContain("is Pablo Honey, which isn't wanted")
  expect(reasons('Radiohead Tribute - The Bends [FLAC]')).toContain('is not an album by Radiohead')
})
