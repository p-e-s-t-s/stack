import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService, { grabs, grabUnits } from '@magpiejs/downloads'
import ImportService from '@magpiejs/import'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import SeriesService from '../src'

let ctx: Context
let dir: string
let seriesId: number

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-tv-import-'))
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(ImportService)
  await ctx.plugin(SeriesService)
  ctx.metadata.register({
    id: 'tmdb',
    kinds: ['series'],
    search: async () => [],
    getSeries: async () => ({
      kind: 'series',
      title: 'Test Show',
      year: 2020,
      ids: { tmdb: '100' },
      seasons: [{ number: 1, episodeCount: 3 }],
    }),
    getEpisodes: async () =>
      [1, 2, 3].map((number) => ({
        season: 1,
        number,
        title: `Part ${number}`,
        airDate: `2020-01-0${number}`,
      })),
  })
  seriesId = (
    await ctx.series.add({
      tmdbId: 100,
      profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
      rootFolderId: ctx.library.addRootFolder(join(dir, 'tv'), 'series').id,
      search: false,
    })
  ).id
  return () => rmSync(dir, { recursive: true, force: true })
})

/** A finished download on disk, its grab row and the episodes it was grabbed for. */
function download(title: string, quality: string, files: string[], episodes: number[]) {
  const out = join(dir, 'downloads', title)
  mkdirSync(out, { recursive: true })
  for (const name of files)
    writeFileSync(join(out, name), Buffer.alloc(name.includes('sample') ? 10 : 1000))
  const now = Date.now()
  const grab = ctx.downloads.db
    .insert(grabs)
    .values({
      mediaId: seriesId,
      title,
      quality,
      formatScore: 0,
      protocol: 'torrent',
      clientId: 'qbit',
      downloadId: title,
      state: 'import_pending',
      outputPath: out,
      grabbedAt: now,
      updatedAt: now,
      lastProgressAt: now,
      release: { guid: title, title, protocol: 'torrent', indexerId: 'x', downloadUrl: '' },
    })
    .returning()
    .get()
  const ids = ctx.series.episodes(seriesId).filter((e) => episodes.includes(e.number))
  ctx.downloads.db
    .insert(grabUnits)
    .values(ids.map((e) => ({ grabId: grab.id, unitId: e.id })))
    .run()
  return grab
}

const season = () => readdirSync(join(dir, 'tv', 'Test Show (2020)', 'Season 01')).sort()
const fileOf = () => {
  const files = ctx.series.episodeFiles(seriesId)
  return ctx.series.episodes(seriesId).map((e) => files.get(e.id)?.path.split('/').pop() ?? '-')
}

describe('episode import', () => {
  it('imports a season pack file by file, and a lone multi-episode file', async () => {
    const pack = download(
      'Test.Show.S01.720p.WEB-DL.x264-GRP',
      'webdl-720p',
      [
        'Test.Show.S01E01.720p.WEB-DL.x264-GRP.mkv',
        'Test.Show.S01E02.720p.WEB-DL.x264-GRP.mkv',
        'Test.Show.S01E02.sample.mkv',
        'Test.Show.S01E07.720p.WEB-DL.x264-GRP.mkv',
      ],
      [1, 2, 3],
    )
    await ctx.import.importGrab(pack.id)
    expect(ctx.downloads.get(pack.id)!.state).toBe('imported')
    expect(season()).toEqual([
      'Test Show - S01E01 - Part 1 [WEB-DL-720p].mkv',
      'Test Show - S01E02 - Part 2 [WEB-DL-720p].mkv',
    ])
    expect(fileOf()).toEqual([
      'Test Show - S01E01 - Part 1 [WEB-DL-720p].mkv',
      'Test Show - S01E02 - Part 2 [WEB-DL-720p].mkv',
      '-',
    ])

    // a better multi-episode file replaces episode 2's file and fills episode 3
    const multi = download(
      'Test.Show.S01E02E03.1080p.BluRay.x264-HQ',
      'bluray-1080p',
      ['show.mkv'],
      [2, 3],
    )
    await ctx.import.importGrab(multi.id)
    expect(season()).toEqual([
      'Test Show - S01E01 - Part 1 [WEB-DL-720p].mkv',
      'Test Show - S01E02-E03 - Part 2 + Part 3 [Bluray-1080p].mkv',
    ])
    expect(fileOf()).toEqual([
      'Test Show - S01E01 - Part 1 [WEB-DL-720p].mkv',
      'Test Show - S01E02-E03 - Part 2 + Part 3 [Bluray-1080p].mkv',
      'Test Show - S01E02-E03 - Part 2 + Part 3 [Bluray-1080p].mkv',
    ])
  })

  it('refuses files that are not an upgrade', async () => {
    await ctx.import.importGrab(
      download('Test.Show.S01E01.1080p.BluRay.x264-HQ', 'bluray-1080p', ['a.mkv'], [1]).id,
    )
    const worse = download('Test.Show.S01E01.720p.HDTV.x264-LOL', 'hdtv-720p', ['b.mkv'], [1])
    await ctx.import.importGrab(worse.id)
    expect(ctx.downloads.get(worse.id)).toMatchObject({
      state: 'import_failed',
      error: expect.stringContaining('not an upgrade'),
    })
  })
})
