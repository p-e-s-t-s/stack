// Phase 4 exit: a standard series (season pack), a daily and an anime series each go from
// search to import, with a fake indexer and download client.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService, { grabs } from '@magpiejs/downloads'
import ImportService from '@magpiejs/import'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import type { EpisodeMetadata, ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SeriesService, { type SeriesType } from '../src'

const GB = 1024 ** 3
const SHOWS: Record<string, { title: string; episodes: EpisodeMetadata[] }> = {
  '1': {
    title: 'Plain Show',
    episodes: [1, 2, 3].map((n) => ({
      season: 1,
      number: n,
      title: `Ep ${n}`,
      airDate: `2020-01-0${n}`,
    })),
  },
  '2': {
    title: 'Late Talk',
    episodes: [1, 2].map((n) => ({
      season: 2024,
      number: n,
      title: `Guest ${n}`,
      airDate: `2024-01-0${n + 1}`,
    })),
  },
  '3': {
    title: 'Frieren',
    episodes: [
      ...[1, 2].map((n) => ({
        season: 1,
        number: n,
        title: `Journey ${n}`,
        airDate: `2023-09-0${n}`,
      })),
      ...[1, 2].map((n) => ({
        season: 2,
        number: n,
        title: `Return ${n}`,
        airDate: `2025-01-0${n}`,
      })),
    ],
  },
}

let ctx: Context
let dir: string
let n = 0
let results: (q: ReleaseQuery) => ReleaseInfo[]
const queries: ReleaseQuery[] = []

const release = (title: string, size = 2 * GB): ReleaseInfo => ({
  guid: title,
  title,
  protocol: 'torrent',
  indexerId: 'fake',
  downloadUrl: `magnet:?xt=urn:btih:${(++n).toString(16).padStart(40, '0')}`,
  size,
  seeders: 20,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-tv-e2e-'))
  queries.length = 0
  ctx = new Context()
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
  await ctx.plugin(SeriesService)
  ctx.metadata.register({
    id: 'tmdb',
    kinds: ['series'],
    search: async () => [],
    getSeries: async (id) => ({
      kind: 'series',
      title: SHOWS[id]!.title,
      ids: { tmdb: id },
      seasons: [...new Set(SHOWS[id]!.episodes.map((e) => e.season))].map((number) => ({
        number,
        episodeCount: 2,
      })),
    }),
    getEpisodes: async (id) => SHOWS[id]!.episodes,
  })
  ctx.indexers.register(
    {
      id: 'fake',
      protocol: 'torrent',
      capabilities: async () => ({
        categories: [],
        searchParams: { movie: [], tv: ['q', 'season', 'ep'], search: ['q'] },
      }),
      search: async (q) => (queries.push(q), results(q)),
      test: async () => ({ ok: true }),
    },
    { name: 'Fake', priority: 1, enableRss: true, enableAutomatic: true, enableInteractive: true },
  )
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
  ctx.library.addRootFolder(join(dir, 'tv'), 'series')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function addShow(tmdbId: number, seriesType: SeriesType) {
  return ctx.series.add({
    tmdbId,
    seriesType,
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: ctx.library.rootFolders('series')[0]!.id,
    search: false,
  })
}

/** The download client finished every grab: files on disk, grabs ready to import. */
async function finishDownloads(files: Record<string, string[]>) {
  for (const grab of ctx.downloads.active()) {
    const out = join(dir, 'downloads', grab.title)
    mkdirSync(out, { recursive: true })
    for (const name of files[grab.title] ?? [`${grab.title}.mkv`])
      writeFileSync(join(out, name), Buffer.alloc(1000))
    ctx.downloads.db
      .update(grabs)
      .set({ state: 'import_pending', outputPath: out })
      .where(eq(grabs.id, grab.id))
      .run()
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
  }
}

const tree = (folder: string) =>
  readdirSync(join(dir, 'tv', folder), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.mkv'))
    .sort()

describe('series end to end', () => {
  it('standard: a season pack', async () => {
    const show = await addShow(1, 'standard')
    results = () => [
      release('Plain.Show.S01E01.1080p.WEB-DL.x264-GRP'),
      release('Plain.Show.S01.1080p.WEB-DL.x264-GRP', 6 * GB),
    ]
    expect(await ctx.series.searchAndGrab(show.id)).toEqual([
      'Plain.Show.S01.1080p.WEB-DL.x264-GRP',
    ])
    await finishDownloads({
      'Plain.Show.S01.1080p.WEB-DL.x264-GRP': [1, 2, 3].map(
        (e) => `Plain.Show.S01E0${e}.1080p.WEB-DL.x264-GRP.mkv`,
      ),
    })
    expect(tree(show.folder)).toEqual([
      'Season 01/Plain Show - S01E01 - Ep 1 [WEB-DL-1080p].mkv',
      'Season 01/Plain Show - S01E02 - Ep 2 [WEB-DL-1080p].mkv',
      'Season 01/Plain Show - S01E03 - Ep 3 [WEB-DL-1080p].mkv',
    ])
    expect(ctx.series.get(show.id)!.stats).toMatchObject({ wanted: 3, downloaded: 3 })
  })

  it('daily: by air date', async () => {
    const show = await addShow(2, 'daily')
    results = (q) =>
      q.episode === '01/02' ? [release('Late.Talk.2024.01.02.Guest.One.1080p.WEB.h264-EDITH')] : []
    const grabbed = await ctx.series.searchAndGrab(show.id)
    expect(queries.map((q) => [q.season, q.episode])).toEqual([
      [2024, '01/02'],
      [2024, '01/03'],
    ])
    expect(grabbed).toEqual(['Late.Talk.2024.01.02.Guest.One.1080p.WEB.h264-EDITH'])
    await finishDownloads({})
    expect(tree(show.folder)).toEqual([
      'Season 2024/Late Talk - 2024-01-02 - Guest 1 [WEB-DL-1080p].mkv',
    ])
  })

  it('anime: by absolute number', async () => {
    const show = await addShow(3, 'anime')
    results = (q) =>
      q.term === 'Frieren 03' ? [release('[SubsPlease] Frieren - 03 (1080p) [ABCD1234].mkv')] : []
    const grabbed = await ctx.series.searchAndGrab(show.id)
    expect(grabbed).toEqual(['[SubsPlease] Frieren - 03 (1080p) [ABCD1234].mkv'])
    await finishDownloads({
      '[SubsPlease] Frieren - 03 (1080p) [ABCD1234].mkv': [
        '[SubsPlease] Frieren - 03 (1080p) [ABCD1234].mkv',
      ],
    })
    // absolute 3 is season 2 episode 1
    expect(tree(show.folder)).toEqual([
      'Season 02/Frieren - S02E01 - 003 - Return 1 [HDTV-1080p].mkv',
    ])
  })
})
