import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import MoviesService from '@magpiejs/movies'
import type { ImportListProvider, ListEntry, MovieMetadata } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import ImportLists, { type ListSettings } from '../src'

let ctx: Context
let entries: ListEntry[]
let settings: ListSettings
let added: number[]
let searched: string[]
let mapped: Record<string, string>

const movie = (tmdb: string, title: string, year: number): ListEntry => ({
  kind: 'movie',
  title,
  year,
  ids: { tmdb },
})

const meta = (id: string): MovieMetadata => ({
  kind: 'movie',
  title: `Movie ${id}`,
  year: 2000,
  ids: { tmdb: id },
})

const provider = (): ImportListProvider => ({
  id: 'fake:one',
  kinds: ['movie'],
  fetch: async () => entries,
  test: async () => ({ ok: true }),
})

beforeEach(async () => {
  entries = []
  added = []
  searched = []
  mapped = {}
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  ctx.metadata.register({
    id: 'tmdb',
    kinds: ['movie'],
    search: async (q) => {
      searched.push(q.term)
      return q.term === 'Heat'
        ? [
            { kind: 'movie', title: 'Heat', year: 1995, ids: { tmdb: '949' } },
            { kind: 'movie', title: 'Heat', year: 1986, ids: { tmdb: '1' } },
          ]
        : []
    },
    getMovie: async (id) => meta(id),
    mapIds: async (ids) =>
      ids.imdb && mapped[ids.imdb] ? { ...ids, tmdb: mapped[ids.imdb] } : ids,
  })
  await ctx.plugin(MoviesService)
  ctx.on('movies/added', (m, o) => {
    added.push(m.id)
    searched.push(`search:${o.search}`)
  })
  await ctx.plugin(ImportLists, { maxAddsPerSync: 50 })
  settings = {
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: ctx.library.addRootFolder('/movies', 'movie').id,
    monitor: true,
    search: false,
    intervalHours: 12,
  }
  ctx.importLists.now = () => 5_000
  ctx.importLists.register(provider(), { name: 'Fake', settings })
})

describe('import lists', () => {
  it('adds new titles once and skips ones the library has', async () => {
    entries = [movie('10', 'A', 2001), movie('11', 'B', 2002)]
    expect(await ctx.importLists.sync('fake:one')).toMatchObject({ added: 2, existing: 0 })
    expect(ctx.movies.list().map((m) => m.details.tmdbId)).toEqual([10, 11])
    expect(ctx.movies.list()[0]).toMatchObject({ monitored: true })
    expect(searched).toContain('search:false')

    expect(await ctx.importLists.sync('fake:one')).toMatchObject({ added: 0, existing: 2 })
    expect(ctx.movies.list()).toHaveLength(2)
    expect(ctx.importLists.info()[0]!.status).toMatchObject({
      added: 0,
      existing: 2,
      lastSyncedAt: 5_000,
    })
  })

  it('maps imdb ids, and matches by name only when exactly one result fits', async () => {
    mapped.tt1 = '20'
    entries = [
      { kind: 'movie', title: 'Mapped', ids: { imdb: 'tt1' } },
      { kind: 'movie', title: 'Heat', year: 1995, ids: {} },
      { kind: 'movie', title: 'Nothing', year: 2000, ids: {} },
      { kind: 'movie', title: 'No year', ids: {} },
    ]
    const result = await ctx.importLists.sync('fake:one')
    expect(result).toMatchObject({ added: 2, unmatched: 2 })
    expect(ctx.movies.list().map((m) => m.details.tmdbId)).toEqual([20, 949])
    expect(ctx.importLists.unmatched().map((u) => u.title)).toEqual(['Nothing', 'No year'])
  })

  it('does not add a title again after the user deletes it', async () => {
    entries = [movie('10', 'A', 2001)]
    await ctx.importLists.sync('fake:one')
    const [added] = ctx.movies.list()
    ctx.movies.remove(added!.id)
    expect(ctx.importLists.exclusions()).toMatchObject([{ key: 'movie:tmdb:10' }])
    expect(await ctx.importLists.sync('fake:one')).toMatchObject({ added: 0, excluded: 1 })
    expect(ctx.movies.list()).toEqual([])

    ctx.importLists.unexclude('movie:tmdb:10')
    expect(await ctx.importLists.sync('fake:one')).toMatchObject({ added: 1 })
  })

  it('does not exclude titles that were not added by a list', async () => {
    const manual = await ctx.movies.add({
      tmdbId: 30,
      profileId: settings.profileId,
      rootFolderId: settings.rootFolderId,
    })
    ctx.movies.remove(manual.id)
    expect(ctx.importLists.exclusions()).toEqual([])
  })

  it('limits one sync to maxAddsPerSync and finishes on the next', async () => {
    ctx.importLists.config.maxAddsPerSync = 2
    entries = [movie('1', 'A', 2001), movie('2', 'B', 2002), movie('3', 'C', 2003)]
    expect(await ctx.importLists.sync('fake:one')).toMatchObject({ added: 2 })
    expect(await ctx.importLists.sync('fake:one')).toMatchObject({ added: 1, existing: 2 })
  })

  it('keeps the library as it was when the list cannot be read', async () => {
    entries = [movie('10', 'A', 2001)]
    await ctx.importLists.sync('fake:one')
    entries = null as never
    const result = await ctx.importLists.sync('fake:one')
    expect(result.error).toBeTruthy()
    expect(ctx.movies.list()).toHaveLength(1)
    expect(ctx.importLists.info()[0]!.status!.lastError).toBeTruthy()
  })

  it('reports a failing provider and a bad profile without throwing', async () => {
    entries = [movie('10', 'A', 2001)]
    settings.profileId = 9999
    const result = await ctx.importLists.sync('fake:one')
    expect(result).toMatchObject({ added: 0, failed: 1, error: 'choose a video quality profile' })
    expect(ctx.movies.list()).toEqual([])
    expect(ctx.importLists.info()[0]!.status!.lastError).toBe('choose a video quality profile')
  })

  it('runs through the job queue', async () => {
    entries = [movie('10', 'A', 2001)]
    ctx.importLists.syncNow('fake:one')
    await ctx.jobs.tick()
    expect(ctx.movies.list()).toHaveLength(1)
  })
})
