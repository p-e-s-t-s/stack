import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService from '@magpiejs/downloads'
import HistoryService from '@magpiejs/history'
import ImportService from '@magpiejs/import'
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

const HD_1080 = 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'
const HD_720 = 'Night.of.the.Living.Dead.1968.720p.BluRay.x264-OLD'
const UHD = 'Night.of.the.Living.Dead.1968.2160p.BluRay.x265-GRP'

let ctx: Context
let dir: string
let results: ReleaseInfo[]
let feed: ReleaseInfo[]
let statuses: DownloadStatus[]
let added: string[]
let movieId: number
let uhd: number

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-targets-'))
  results = []
  feed = []
  statuses = []
  added = []
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
  await ctx.plugin(HistoryService)
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
      list: async () => statuses,
      remove: async () => {},
      test: async () => ({ ok: true, message: '' }),
    },
    { name: 'Client', priority: 1, category: 'magpie' },
  )
  const root = ctx.library.addRootFolder(join(dir, 'movies'), 'movie')
  const item = ctx.library.add({
    kind: 'movie',
    title: 'Night of the Living Dead',
    year: 1968,
    externalIds: {},
    primaryProvider: 'tmdb',
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: root.id,
    folder: 'Night of the Living Dead (1968)',
  })
  ctx.movies.db
    .insert(details)
    .values({ mediaId: item.id, tmdbId: 1, physicalRelease: '1968-01-01' })
    .run()
  movieId = item.id
  uhd = ctx.decision.profiles().find((p) => p.name === 'Ultra HD')!.id
  ctx.library.saveFileHandling({ recycleBin: join(dir, 'recycle') })
  return () => rmSync(dir, { recursive: true, force: true })
})

/** The client reports a finished download with a file on disk; runs the import. */
async function finish(n: number, file: string, size = 3000) {
  const out = join(dir, 'downloads', String(n))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, file), Buffer.alloc(size))
  statuses = [
    ...statuses.filter((s) => s.downloadId !== hash(n)),
    { downloadId: hash(n), name: 'x', state: 'completed', progress: 1, outputPath: out },
  ]
  await ctx.downloads.monitor()
  await ctx.jobs.tick()
}

const folder = () => join(dir, 'movies', 'Night of the Living Dead (1968)')

describe('targets', () => {
  it('a movie without extra versions behaves as before', () => {
    const movie = ctx.movies.get(movieId)!
    expect(movie.targets).toMatchObject([{ id: null, name: null, monitored: true }])
    expect(movie.files).toEqual([])
  })

  it('refuses a duplicate name, a non-video profile and removing the primary', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd, monitored: false })
    expect(() => ctx.movies.addTarget(movieId, { name: '4k', profileId: uhd })).toThrow(
      /already has a version/,
    )
    const audio = ctx.decision.profiles().find((p) => p.family !== 'video')
    if (audio)
      expect(() => ctx.movies.addTarget(movieId, { name: 'x', profileId: audio.id })).toThrow()
    await expect(ctx.movies.removeTarget(movieId, 0)).rejects.toThrow()
  })

  it('grabs a release per version, each into its own file in the movie folder', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd, monitored: false })
    const target = ctx.library.targets(movieId)[0]!
    ctx.library.updateTarget(target.id, { monitored: true })
    results = [release(1, HD_1080), release(2, UHD)]
    await ctx.movies.searchAndGrab!(movieId)
    // the 1080p goes to the primary version, the 2160p to the 4K one; neither blocks the other
    expect(added.sort()).toEqual([HD_1080, UHD].sort())
    const grabs = ctx.downloads.active()
    expect(grabs.find((g) => g.title === UHD)!.targetId).toBe(target.id)
    expect(grabs.find((g) => g.title === HD_1080)!.targetId).toBeNull()

    await finish(1, 'a.mkv')
    await finish(2, 'b.mkv', 9000)
    const files = ctx.library.files(movieId)
    expect(files).toHaveLength(2)
    expect(files.find((f) => f.targetId === target.id)!.path).toBe(
      'Night of the Living Dead (1968) - 4K.mkv',
    )
    expect(files.find((f) => f.targetId === null)!.path).toBe(
      'Night of the Living Dead (1968) [Bluray-1080p].mkv',
    )
    expect(readdirSync(folder()).sort()).toHaveLength(2)
    expect(
      ctx.history.list({ mediaId: movieId }).find((e) => e.type === 'imported')!.data,
    ).toHaveProperty('targetId')

    // everything is met now
    const movie = ctx.movies.get(movieId)!
    expect(movie.targets.every((t) => t.file)).toBe(true)
    expect(movie.file!.id).toBe(files.find((f) => f.targetId === null)!.id)
  })

  it('an upgrade replaces only that version’s file', async () => {
    ctx.movies.addTarget(movieId, { name: 'Mobile', profileId: ctx.movies.get(movieId)!.profileId })
    results = [release(1, HD_720)]
    await ctx.movies.searchAndGrab!(movieId, true, null)
    await finish(1, 'a.mkv')
    expect(ctx.library.files(movieId, null)).toHaveLength(1)
    expect(ctx.library.files(movieId)).toHaveLength(1)

    // a better release for the extra version must not touch the primary file
    const target = ctx.library.targets(movieId)[0]!
    results = [release(2, HD_1080)]
    await ctx.movies.searchAndGrab!(movieId, true, target.id)
    await finish(2, 'b.mkv')
    expect(ctx.library.files(movieId, null).map((f) => f.quality)).toEqual(['bluray-720p'])
    expect(ctx.library.files(movieId, target.id)).toHaveLength(1)
    expect(existsSync(join(folder(), 'Night of the Living Dead (1968) - Mobile.mkv'))).toBe(true)
  })

  it('does not suppress one version’s search while another downloads', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd })
    results = [release(1, HD_1080)]
    await ctx.movies.searchAndGrab!(movieId)
    expect(added).toEqual([HD_1080])
    results = [release(2, UHD)]
    await ctx.movies.searchAndGrab!(movieId)
    expect(added).toEqual([HD_1080, UHD])
  })

  it('a failed 4K download blocklists the release for the item and re-searches only 4K', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd })
    const other = 'Night.of.the.Living.Dead.1968.2160p.WEB-DL.x265-ALT'
    results = [release(1, HD_1080), release(2, UHD), release(3, other)]
    await ctx.movies.searchAndGrab!(movieId)
    expect(added).toHaveLength(2)
    statuses = [
      { downloadId: hash(2), name: 'x', state: 'failed', progress: 0.1, error: 'tracker error' },
    ]
    await ctx.downloads.monitor()
    await ctx.jobs.tick()
    expect(ctx.downloads.blocklisted(movieId).map((b) => b.title)).toEqual([UHD])
    // the 1080p is still downloading; only the 4K was searched again
    expect(added.slice(2)).toEqual([other])
  })

  it('RSS grabs a release for every wanted version', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd })
    feed = [release(1, HD_1080), release(2, UHD), release(3, HD_720)]
    await ctx.indexers.syncRss()
    await new Promise((r) => setTimeout(r, 10))
    expect(added.sort()).toEqual([HD_1080, UHD].sort())
  })

  it('an unmonitored version is ignored by automatic search but not by a manual one', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd, monitored: false })
    results = [release(1, UHD)]
    await ctx.movies.searchAndGrab!(movieId)
    expect(added).toEqual([])
    const target = ctx.library.targets(movieId)[0]!
    await ctx.movies.searchAndGrab!(movieId, true, target.id)
    expect(added).toEqual([UHD])
  })

  it('removing a version with a file asks what to do with it', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd })
    const target = ctx.library.targets(movieId)[0]!
    results = [release(2, UHD)]
    await ctx.movies.searchAndGrab!(movieId, true, target.id)
    await finish(2, 'b.mkv')
    const path = join(folder(), 'Night of the Living Dead (1968) - 4K.mkv')
    expect(existsSync(path)).toBe(true)
    await expect(ctx.movies.removeTarget(movieId, target.id)).rejects.toThrow(/choose/)
    expect(() => ctx.library.removeTarget(target.id)).toThrow()
    await ctx.movies.removeTarget(movieId, target.id, 'delete')
    expect(existsSync(path)).toBe(false)
    expect(ctx.library.targets(movieId)).toEqual([])
    expect(ctx.library.files(movieId)).toEqual([])
  })

  it('removing the movie removes its versions and their files', async () => {
    ctx.movies.addTarget(movieId, { name: '4K', profileId: uhd })
    const target = ctx.library.targets(movieId)[0]!
    ctx.library.addFile({
      mediaId: movieId,
      targetId: target.id,
      path: 'x - 4K.mkv',
      size: 1,
      quality: 'bluray-2160p',
      languages: [],
      revision: { version: 1, real: 0 },
    } as never)
    ctx.movies.remove(movieId)
    expect(ctx.library.targets(movieId)).toEqual([])
    expect(ctx.library.files(movieId)).toEqual([])
  })
})
