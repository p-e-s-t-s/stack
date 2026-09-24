import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import type { EpisodeMetadata, SeriesMetadata } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import SeriesService from '../src'

const DAY = 86_400_000
const date = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

let episodes: EpisodeMetadata[]
const meta = (): SeriesMetadata => ({
  kind: 'series',
  title: 'Test Show',
  year: 2020,
  ids: { tmdb: '100', tvdb: '200' },
  seasons: [
    { number: 0, episodeCount: 1 },
    { number: 1, episodeCount: 2 },
    { number: 2, episodeCount: 2 },
  ],
})

let ctx: Context
let options: { profileId: number; rootFolderId: number }
beforeEach(async () => {
  episodes = [
    { season: 0, number: 1, airDate: date(-400) },
    { season: 1, number: 1, airDate: date(-300) },
    { season: 1, number: 2, airDate: date(-293) },
    { season: 2, number: 1, airDate: date(-7) },
    { season: 2, number: 2, airDate: date(7) },
  ]
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(SeriesService)
  ctx.metadata.register({
    id: 'tmdb',
    kinds: ['series'],
    search: async () => [meta()],
    getSeries: async () => meta(),
    getEpisodes: async () => episodes,
  })
  options = {
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: ctx.library.addRootFolder('/tv', 'series').id,
  }
})

const monitored = (id: number) =>
  ctx.series
    .episodes(id)
    .filter((e) => e.monitored)
    .map((e) => `${e.season}x${e.number}`)

describe('series', () => {
  it('adds a series with its episodes, monitoring what was chosen', async () => {
    const all = await ctx.series.add({ tmdbId: 100, ...options })
    expect(all.folder).toBe('Test Show (2020)')
    expect(all.details.tvdbId).toBe(200)
    // specials are left out unless asked for
    expect(monitored(all.id)).toEqual(['1x1', '1x2', '2x1', '2x2'])
    // aired, monitored, regular episodes; the next one is upcoming
    expect(all.stats).toMatchObject({ wanted: 3, downloaded: 0, total: 4, nextAiring: date(7) })
    expect(ctx.series.episodes(all.id).map((e) => e.absoluteNumber)).toEqual([null, 1, 2, 3, 4])

    ctx.series.remove(all.id)
    const latest = await ctx.series.add({ tmdbId: 100, ...options, monitor: 'latest' })
    expect(monitored(latest.id)).toEqual(['2x1', '2x2'])
    expect(latest.seasons.map((s) => [s.number, s.monitored])).toEqual([
      [0, false],
      [1, false],
      [2, true],
    ])

    ctx.series.remove(latest.id)
    const future = await ctx.series.add({ tmdbId: 100, ...options, monitor: 'future' })
    expect(monitored(future.id)).toEqual(['2x2'])
  })

  it('refresh adds new episodes, updates old ones and drops removed ones', async () => {
    const series = await ctx.series.add({ tmdbId: 100, ...options, monitor: 'latest' })
    episodes = [
      ...episodes.filter((e) => !(e.season === 1 && e.number === 2)),
      { season: 2, number: 3, airDate: date(14), title: 'New' },
    ]
    episodes.find((e) => e.season === 2 && e.number === 1)!.title = 'Renamed'
    await ctx.series.refresh(series.id)

    const after = ctx.series.episodes(series.id)
    expect(after.map((e) => `${e.season}x${e.number}`)).toEqual(['0x1', '1x1', '2x1', '2x2', '2x3'])
    expect(after.find((e) => e.season === 2 && e.number === 1)!.title).toBe('Renamed')
    // new episodes in a monitored season are monitored
    expect(monitored(series.id)).toEqual(['2x1', '2x2', '2x3'])
  })
})
