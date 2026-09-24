import Timer from '@cordisjs/plugin-timer'
import HTTP from '@cordisjs/plugin-http'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService from '@magpiejs/downloads'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import type { DownloadStatus, ReleaseInfo } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import MoviesService from '../src'
import { details } from '../src/schema'

const GB = 1024 ** 3
const hash = (n: number) => n.toString(16).padStart(40, '0')
const release = (n: number, title: string): ReleaseInfo => ({
  guid: `g${n}`,
  title,
  protocol: 'torrent',
  indexerId: 'fake',
  downloadUrl: `magnet:?xt=urn:btih:${hash(n)}`,
  size: 8 * GB,
  seeders: 50,
})

let ctx: Context
let results: ReleaseInfo[]
let feed: ReleaseInfo[]
let statuses: DownloadStatus[]
const added: string[] = []
beforeEach(async () => {
  results = []
  feed = []
  statuses = []
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
  await ctx.plugin(MoviesService)
  ctx.indexers.register(
    {
      id: 'fake',
      protocol: 'torrent',
      capabilities: async () => ({
        categories: [],
        searchParams: { movie: ['q'], tv: [], search: ['q'] },
      }),
      search: async () => results,
      rss: async () => feed,
      test: async () => ({ ok: true, message: '' }),
    },
    {
      name: 'Fake',
      priority: 1,
      enableRss: true,
      enableAutomatic: true,
      enableInteractive: true,
    },
  )
  ctx.downloads.register(
    {
      id: 'client',
      protocol: 'torrent',
      add: async (payload) => {
        added.push(payload.release.title)
        return (payload as { hash: string }).hash
      },
      list: async () => statuses,
      remove: async () => {},
      test: async () => ({ ok: true, message: '' }),
    },
    { name: 'Client', priority: 1, category: 'magpie' },
  )
})

let nextTmdb = 1
function addMovie(title: string, year: number, options: { monitored?: boolean } = {}) {
  const folder =
    ctx.library.rootFolders('movie')[0] ?? ctx.library.addRootFolder('/tmp/magpie-auto', 'movie')
  const item = ctx.library.add({
    kind: 'movie',
    title,
    year,
    externalIds: {},
    primaryProvider: 'tmdb',
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: folder.id,
    folder: `${title} (${year})`,
    monitored: options.monitored ?? true,
  })
  ctx.movies.db
    .insert(details)
    .values({ mediaId: item.id, tmdbId: nextTmdb++, physicalRelease: `${year}-01-01` })
    .run()
  return ctx.movies.get(item.id)!
}

describe('automation', () => {
  it('searches on add, and grabs the next best release after a failure', async () => {
    results = [
      release(1, 'Night.of.the.Living.Dead.1968.720p.BluRay.x264-OLD'),
      release(2, 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'),
    ]
    const movie = addMovie('Night of the Living Dead', 1968)
    ctx.emit('movies/added', movie, { search: true })
    await ctx.jobs.tick()
    expect(added).toEqual(['Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'])

    statuses = [
      { downloadId: hash(2), name: 'x', state: 'failed', progress: 0.1, error: 'tracker error' },
    ]
    await ctx.downloads.monitor()
    await ctx.jobs.tick()
    expect(added.at(-1)).toBe('Night.of.the.Living.Dead.1968.720p.BluRay.x264-OLD')
  })

  it('grabs wanted movies from RSS once, and skips unmonitored ones', async () => {
    addMovie('Night of the Living Dead', 1968)
    addMovie('Carnival of Souls', 1962, { monitored: false })
    feed = [
      release(3, 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'),
      release(4, 'Carnival.of.Souls.1962.1080p.BluRay.x264-GRP'),
      release(5, 'Night.of.the.Living.Dead.1968.720p.BluRay.x264-OLD'),
      release(6, 'Some.Other.Movie.2001.1080p.BluRay.x264-GRP'),
    ]
    await ctx.indexers.syncRss()
    await new Promise((r) => setTimeout(r, 10))
    expect(added).toEqual(['Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'])

    // the same feed again brings nothing new
    await ctx.indexers.syncRss()
    await new Promise((r) => setTimeout(r, 10))
    expect(added).toHaveLength(1)
  })
})
