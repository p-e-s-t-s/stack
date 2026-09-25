// Phase 4.8 exit: add an artist; a wanted album is found, and a FLAC release is imported with
// correct per-track names; a later FLAC 24-bit release replaces an MP3 album as an upgrade —
// through the real indexers, Torznab, decision, downloads, import and calendar plugins.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grabs } from '@magpiejs/downloads'
import * as torznab from '@magpiejs/indexer-torznab'
import {
  createTestContext,
  fakeDownloadClient,
  fakeTorznab,
  finishDownloads,
} from '@magpiejs/testing'
import { afterAll, expect, it } from 'vitest'
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

const fake = await fakeTorznab({
  caps: { music: ['q', 'artist', 'album'], categories: [{ id: 3000, name: 'Audio' }] },
  items: () =>
    offered.map((title) => ({
      title,
      size: 100_000_000,
      hash: String(Object.keys(contents).indexOf(title) + 1).repeat(40),
      seeders: 9,
    })),
})
afterAll(() => fake.close())

it('finds wanted albums, imports them track by track, and upgrades MP3 to FLAC 24-bit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-music-'))
  const ctx = await createTestContext()
  await ctx.plugin(torznab, { name: 'Music', url: `${fake.url}/api` } as unknown as torznab.Config)
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
  const client = fakeDownloadClient()
  ctx.downloads.register(client.client, { name: 'Client', priority: 1, category: 'magpie' })
  /** The client finishes each active download with its files (all but `leaveOut`). */
  const finish = (leaveOut: string[] = []) =>
    finishDownloads(ctx, {
      dir: join(dir, 'downloads'),
      files: (grab) =>
        Object.fromEntries(
          contents[grab.title]!.filter((n) => !leaveOut.includes(n)).map((n) => [n, 'audio']),
        ),
    })
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
