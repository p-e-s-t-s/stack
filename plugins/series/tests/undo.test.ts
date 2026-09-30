import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
  dir = mkdtempSync(join(tmpdir(), 'magpie-tv-undo-'))
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
  ctx.import.trashDir = join(dir, 'trash')
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
  return ctx.series
    .episodes(seriesId)
    .map((e) => (files.get(e.id) ? basename(files.get(e.id)!.path) : '-'))
}

describe('undo of episode imports', () => {
  const PACK = 'Test.Show.S01.720p.WEB-DL.x264-GRP'
  const packFiles = [1, 2].map((n) => `Test.Show.S01E0${n}.720p.WEB-DL.x264-GRP.mkv`)

  it('undoes a whole season pack with one call', async () => {
    const pack = download(PACK, 'webdl-720p', packFiles, [1, 2, 3])
    await ctx.import.importGrab(pack.id)
    expect(season()).toHaveLength(2)
    const roots = ctx.import.journal.list()
    expect(roots).toHaveLength(2)
    expect(new Set(roots.map((r) => r.batchId)).size).toBe(1)

    const outcomes = await ctx.import.undo.undoBatch(roots[0]!.batchId)

    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(existsSync(join(dir, 'tv', 'Test Show (2020)', 'Season 01', season()[0] ?? 'x'))).toBe(
      false,
    )
    expect(fileOf()).toEqual(['-', '-', '-'])
    expect(ctx.library.files(seriesId)).toHaveLength(0)
  })

  it('puts a replaced multi-episode file back with only the episodes it covered', async () => {
    await ctx.import.importGrab(download(PACK, 'webdl-720p', packFiles, [1, 2, 3]).id)
    const multi = download(
      'Test.Show.S01E02E03.1080p.BluRay.x264-HQ',
      'bluray-1080p',
      ['show.mkv'],
      [2, 3],
    )
    await ctx.import.importGrab(multi.id)
    const [newest] = ctx.import.journal.list()
    // the episode 2 file, parked as a part of this import
    expect(ctx.import.journal.children(newest!.id)).toHaveLength(1)

    expect((await ctx.import.undo.undo(newest!.id)).ok).toBe(true)

    expect(season()).toEqual([
      'Test Show - S01E01 - Part 1 [WEB-DL-720p].mkv',
      'Test Show - S01E02 - Part 2 [WEB-DL-720p].mkv',
    ])
    expect(fileOf()).toEqual([
      'Test Show - S01E01 - Part 1 [WEB-DL-720p].mkv',
      'Test Show - S01E02 - Part 2 [WEB-DL-720p].mkv',
      '-',
    ])
  })

  it('leaves a multi-episode file alone that other episodes still need', async () => {
    await ctx.import.importGrab(
      download('Test.Show.S01E01E02.720p.WEB-DL.x264-GRP', 'webdl-720p', ['both.mkv'], [1, 2]).id,
    )
    const both = season()
    expect(both).toHaveLength(1)
    // a better file for episode 1 only: the shared file stays for episode 2
    const single = download(
      'Test.Show.S01E01.1080p.BluRay.x264-HQ',
      'bluray-1080p',
      ['one.mkv'],
      [1],
    )
    await ctx.import.importGrab(single.id)
    expect(season()).toHaveLength(2)
    const [newest] = ctx.import.journal.list()
    expect(ctx.import.journal.children(newest!.id)).toHaveLength(0)

    expect((await ctx.import.undo.undo(newest!.id)).ok).toBe(true)

    expect(season()).toEqual(both)
    expect(fileOf()[0]).toBe(both[0])
    expect(fileOf()[1]).toBe(both[0])
  })
})
