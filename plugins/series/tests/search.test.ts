import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService from '@magpiejs/downloads'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import { parse } from '@magpiejs/parser'
import type { ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import SeriesService, { episodesFor } from '../src'

const GB = 1024 ** 3
let n = 0
const release = (title: string, size = 2 * GB): ReleaseInfo => ({
  guid: title,
  title,
  protocol: 'torrent',
  indexerId: 'fake',
  downloadUrl: `magnet:?xt=urn:btih:${(++n).toString(16).padStart(40, '0')}`,
  size,
  seeders: 20,
})

let ctx: Context
let results: ReleaseInfo[]
let feed: ReleaseInfo[]
const queries: ReleaseQuery[] = []
const added: string[] = []
let seriesId: number

beforeEach(async () => {
  results = []
  feed = []
  queries.length = 0
  added.length = 0
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
      seasons: [1, 2].map((number) => ({ number, episodeCount: 3 })),
    }),
    getEpisodes: async () =>
      [1, 2].flatMap((season) =>
        [1, 2, 3].map((number) => ({ season, number, airDate: `202${season}-01-0${number}` })),
      ),
  })
  ctx.indexers.register(
    {
      id: 'fake',
      protocol: 'torrent',
      capabilities: async () => ({
        categories: [],
        searchParams: { movie: [], tv: ['q', 'season', 'ep'], search: ['q'] },
      }),
      search: async (q) => (queries.push(q), results),
      rss: async () => feed,
      test: async () => ({ ok: true }),
    },
    { name: 'Fake', priority: 1, enableRss: true, enableAutomatic: true, enableInteractive: true },
  )
  ctx.downloads.register(
    {
      id: 'client',
      protocol: 'torrent',
      add: async (payload) => {
        added.push(payload.release.title)
        return (payload as { hash: string }).hash
      },
      list: async () => [],
      remove: async () => {},
      test: async () => ({ ok: true }),
    },
    { name: 'Client', priority: 1, category: 'magpie' },
  )
  const series = await ctx.series.add({
    tmdbId: 100,
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: ctx.library.addRootFolder('/tv', 'series').id,
    search: false,
  })
  seriesId = series.id
})

const ids = (season: number, ...numbers: number[]) =>
  ctx.series
    .episodes(seriesId)
    .filter((e) => e.season === season && (!numbers.length || numbers.includes(e.number)))
    .map((e) => e.id)

describe('episode search', () => {
  it('maps releases to episodes', () => {
    const show = ctx.series.get(seriesId)!
    const all = ctx.series.episodes(seriesId)
    const covers = (title: string) =>
      episodesFor(show, parse(title, { kind: 'series' }), all).map((e) => `${e.season}x${e.number}`)
    expect(covers('Test.Show.S01E02.1080p.WEB-DL.x264-GRP')).toEqual(['1x2'])
    expect(covers('Test.Show.S01E02E03.1080p.WEB-DL.x264-GRP')).toEqual(['1x2', '1x3'])
    expect(covers('Test.Show.S02.1080p.BluRay.x264-GRP')).toEqual(['2x1', '2x2', '2x3'])
    expect(covers('Test.Show.S03E01.1080p.WEB-DL.x264-GRP')).toEqual([])
  })

  it('grabs a season pack for a whole season, and single episodes otherwise', async () => {
    results = [
      release('Test.Show.S01E01.1080p.WEB-DL.x264-GRP'),
      release('Test.Show.S01.1080p.WEB-DL.x264-GRP', 6 * GB),
      release('Test.Show.S02E02.1080p.WEB-DL.x264-GRP'),
      release('Other.Show.S01.1080p.WEB-DL.x264-GRP', 6 * GB),
    ]
    const grabbed = await ctx.series.searchAndGrab(seriesId, [...ids(1), ...ids(2, 2)])
    expect(grabbed).toEqual([
      'Test.Show.S01.1080p.WEB-DL.x264-GRP',
      'Test.Show.S02E02.1080p.WEB-DL.x264-GRP',
    ])
    // one query per season; the episode number when only one is wanted
    expect(queries.map((q) => [q.season, q.episode])).toEqual([
      [1, undefined],
      [2, 2],
    ])

    // while those download, the same episodes aren't grabbed again
    const again = await ctx.series.search(seriesId, ids(1, 1), 'interactive')
    const single = again.results.find((r) => r.release.title.includes('S01E01'))!
    expect(single.decision.rejections.map((r) => r.rule)).toContain('in-queue')
    const other = again.results.find((r) => r.release.title.startsWith('Other'))!
    expect(other.decision.rejections.map((r) => r.rule)).toContain('series-match')
  })

  it('searches when a series is added, and grabs wanted episodes from RSS', async () => {
    results = [release('Test.Show.S01.1080p.WEB-DL.x264-GRP', 6 * GB)]
    const show = ctx.series.get(seriesId)!
    ctx.emit('series/added', show, { search: true })
    await ctx.jobs.tick()
    // season 1 as a pack; nothing for season 2 in the results
    expect(added).toEqual(['Test.Show.S01.1080p.WEB-DL.x264-GRP'])

    feed = [
      release('Test.Show.S02E03.1080p.WEB-DL.x264-GRP'),
      release('Test.Show.S01E01.1080p.WEB-DL.x264-GRP'), // already downloading in the pack
      release('Test.Show.S02E03.720p.HDTV.x264-LOL'), // worse than the one above
    ]
    await ctx.indexers.syncRss()
    await new Promise((r) => setTimeout(r, 10))
    expect(added.slice(1)).toEqual(['Test.Show.S02E03.1080p.WEB-DL.x264-GRP'])
  })
})
