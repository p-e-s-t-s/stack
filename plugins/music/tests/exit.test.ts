// Phase 4.8 exit: add an artist; a wanted album is found, and a FLAC release is imported with
// correct per-track names; a later FLAC 24-bit release replaces an MP3 album as an upgrade —
// through the real indexers, Torznab, decision, downloads, import and calendar plugins.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import MusicService from '../src'

const TRACKS: Record<string, { number: number; tracks: string[] }[]> = {
  g1: [
    { number: 1, tracks: ['15 Step', 'Bodysnatchers', 'Nude'] },
    { number: 2, tracks: ['MK 1', 'Down Is the New Up'] },
  ],
  g2: [{ number: 1, tracks: ['Everything in Its Right Place', 'Kid A', 'The National Anthem'] }],
}

// what the indexer has, and what each download holds
const offered = ['Radiohead - In Rainbows (2007) [FLAC]', 'Radiohead-Kid_A-WEB-2000-GRP']
const contents: Record<string, string[]> = {
  'Radiohead - In Rainbows (2007) [FLAC]': [
    'CD1/01 - 15 Step.flac',
    'CD1/02 - Bodysnatchers.flac',
    'CD1/03 - Nude.flac',
    'CD2/01 - MK 1.flac',
    'CD2/02 - Down Is the New Up.flac',
    'folder.jpg',
  ],
  'Radiohead-Kid_A-WEB-2000-GRP': [
    '01-radiohead-everything_in_its_right_place-grp.mp3',
    '02-radiohead-kid_a-grp.mp3',
    '03-radiohead-the_national_anthem-grp.mp3',
  ],
  'Radiohead - Kid A (2000) [FLAC 24-96]': [
    '1. Everything In Its Right Place.flac',
    '2. Kid A.flac',
    '3. The National Anthem.flac',
  ],
}

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
    const item = (title: string, i: number) =>
      `<item><title>${title}</title><guid>${title}</guid><size>100000000</size>
        <link>magnet:?xt=urn:btih:${String(i).repeat(40)}</link><torznab:attr name="seeders" value="9"/></item>`
    res.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
      ${offered.map((t) => item(t, Object.keys(contents).indexOf(t) + 1)).join('')}
    </channel></rss>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('finds wanted albums, imports them track by track, and upgrades MP3 to FLAC 24-bit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-music-'))
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
  await ctx.plugin(torznab, { name: 'Music', url: `${base}/api` } as unknown as torznab.Config)
  await ctx.plugin(MusicService)
  ctx.metadata.register({
    id: 'musicbrainz',
    kinds: ['music'],
    search: async () => [],
    getArtist: async (id) => ({ kind: 'music', title: 'Radiohead', ids: { musicbrainz: id } }),
    getAlbums: async () => [
      {
        ids: { musicbrainz: 'g1' },
        title: 'In Rainbows',
        primaryType: 'Album',
        secondaryTypes: [],
        releaseDate: '2007-10-10',
      },
      {
        ids: { musicbrainz: 'g2' },
        title: 'Kid A',
        primaryType: 'Album',
        secondaryTypes: [],
        releaseDate: '2000-10-02',
      },
    ],
    getTracks: async (id) => ({
      releaseId: `r-${id}`,
      discs: TRACKS[id]!.map((d) => ({
        number: d.number,
        tracks: d.tracks.map((title, i) => ({ number: i + 1, title, lengthMs: 60_000 })),
      })),
    }),
  })
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
  /** The client finishes each active download with its files (all but `leaveOut`). */
  const finish = async (leaveOut: string[] = []) => {
    for (const grab of ctx.downloads.active().filter((g) => g.state !== 'import_failed')) {
      const out = join(dir, 'downloads', grab.title)
      for (const name of contents[grab.title]!.filter((n) => !leaveOut.includes(n))) {
        mkdirSync(join(out, name, '..'), { recursive: true })
        writeFileSync(join(out, name), 'audio')
      }
      ctx.downloads.db
        .update(grabs)
        .set({ state: 'import_pending', outputPath: out })
        .where(eq(grabs.id, grab.id))
        .run()
      await ctx.import.importGrab(grab.id)
    }
  }
  const tree = (album: string) =>
    (readdirSync(join(dir, 'music', 'Radiohead', album), { recursive: true }) as string[]).sort()

  const artist = await ctx.music.add({
    artistId: 'A1',
    profileId: ctx.decision.profiles('audio').find((p) => p.name === 'Any')!.id,
    rootFolderId: ctx.library.addRootFolder(join(dir, 'music'), 'music').id,
  })
  await ctx.jobs.tick()
  expect(
    ctx.downloads
      .active()
      .map((g) => [g.title, g.quality])
      .sort(),
  ).toEqual([
    ['Radiohead - In Rainbows (2007) [FLAC]', 'flac'],
    ['Radiohead-Kid_A-WEB-2000-GRP', 'mp3'],
  ])

  // imported track by track, discs kept apart; the scene MP3s named from the track list
  await finish()
  expect(tree('In Rainbows (2007)')).toEqual([
    '1-01 - 15 Step.flac',
    '1-02 - Bodysnatchers.flac',
    '1-03 - Nude.flac',
    '2-01 - MK 1.flac',
    '2-02 - Down Is the New Up.flac',
  ])
  expect(tree('Kid A (2000)')).toEqual([
    '01 - Everything in Its Right Place.mp3',
    '02 - Kid A.mp3',
    '03 - The National Anthem.mp3',
  ])
  // MP3 is below the profile's cutoff (FLAC): Kid A is still wanted
  expect(ctx.music.wantedAlbums(artist.id).map((a) => a.title)).toEqual(['Kid A'])

  // a FLAC 24-bit release appears; its first download is missing a track and is refused
  offered.push('Radiohead - Kid A (2000) [FLAC 24-96]')
  await ctx.music.searchAndGrab(artist.id)
  await finish(['3. The National Anthem.flac'])
  const upgrade = ctx.downloads.db
    .select()
    .from(grabs)
    .all()
    .find((g) => g.title === 'Radiohead - Kid A (2000) [FLAC 24-96]')
  expect(upgrade).toMatchObject({
    title: 'Radiohead - Kid A (2000) [FLAC 24-96]',
    quality: 'flac-24',
    state: 'import_failed',
  })
  expect(upgrade!.error).toBe('2 of 3 tracks of Kid A found; missing 3 The National Anthem')
  expect(tree('Kid A (2000)')).toHaveLength(3)

  // complete, it replaces the MP3s
  writeFileSync(join(upgrade!.outputPath!, '3. The National Anthem.flac'), 'audio')
  await ctx.import.importGrab(upgrade!.id)
  expect(tree('Kid A (2000)')).toEqual([
    '01 - Everything in Its Right Place.flac',
    '02 - Kid A.flac',
    '03 - The National Anthem.flac',
  ])
  expect(ctx.music.wantedAlbums(artist.id)).toEqual([])
  expect(
    ctx.library
      .files(artist.id)
      .map((f) => f.quality)
      .sort(),
  ).toEqual([...Array(5).fill('flac'), ...Array(3).fill('flac-24')])

  // and on the calendar
  expect(
    ctx.calendar.entries('2007-10-01', '2007-10-31').map((e) => [e.title, e.subtitle, e.state]),
  ).toEqual([['Radiohead', 'In Rainbows · Album', 'downloaded']])
  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})
