import { dirname, join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService from '@magpiejs/downloads'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import MoviesService from '@magpiejs/movies'
import SeriesService from '@magpiejs/series'
import { Context } from 'cordis'
import { beforeEach, expect, it } from 'vitest'
import ImportService, { fileSystem, placeSafely, ReviewService } from '../src'

let ctx: Context
let dir: string
let profileId: number
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-review-'))
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
  await ctx.plugin(MoviesService)
  await ctx.plugin(SeriesService)
  ctx.metadata.register({
    id: 'tmdb',
    kinds: ['movie', 'series'],
    search: async (q) => [
      {
        kind: q.kind!,
        title: q.kind === 'movie' ? 'Test Movie' : 'Test Show',
        year: 2020,
        ids: { tmdb: q.kind === 'movie' ? '10' : '20' },
      },
    ],
    getMovie: async () => ({ kind: 'movie', title: 'Test Movie', year: 2020, ids: { tmdb: '10' } }),
    getSeries: async () => ({
      kind: 'series',
      title: 'Test Show',
      year: 2020,
      ids: { tmdb: '20' },
      seasons: [
        { number: 0, episodeCount: 1 },
        { number: 1, episodeCount: 3 },
      ],
    }),
    getEpisodes: async () => [
      { season: 0, number: 1, title: 'Special' },
      ...[1, 2, 3].map((number) => ({
        season: 1,
        number,
        title: `Part ${number}`,
        airDate: `2020-01-0${number}`,
      })),
    ],
  })
  profileId = ctx.decision.profiles('video')[0]!.id
  return () => rmSync(dir, { recursive: true, force: true })
})
function file(path: string, contents = 'video') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  return path
}
async function movie() {
  const root = ctx.library.addRootFolder(join(dir, 'movies'), 'movie')
  return ctx.movies.add({ tmdbId: 10, profileId, rootFolderId: root.id, search: false })
}
it('adopts existing movie files in place and repeats without duplicate records', async () => {
  const root = join(dir, 'existing')
  const source = file(join(root, 'My Existing Folder', 'Test.Movie.2020.1080p.WEB-DL.mkv'))
  let session = await ctx.import.review.scan({ kind: 'movie', mode: 'adopt', path: root })
  expect(ctx.movies.list()).toHaveLength(0)
  expect(session.rows[0]!.suggestions).toHaveLength(1)
  Object.assign(session.rows[0]!, { selected: true, tmdbId: 10, profileId })
  session = await ctx.import.review.preview(session.id, session.rows, 'hardlink')
  expect(ctx.movies.list()).toHaveLength(0)
  session = await ctx.import.review.commit(session.id)
  expect(session.rows[0]!.error).toBeUndefined()
  expect(session.complete).toBe(true)
  const item = ctx.movies.list()[0]!
  expect(item).toMatchObject({ folder: 'My Existing Folder', monitored: false })
  expect(readFileSync(source, 'utf8')).toBe('video')
  session = await ctx.import.review.scan({ kind: 'movie', mode: 'adopt', path: root })
  await ctx.import.review.preview(session.id, session.rows, 'hardlink')
  await ctx.import.review.commit(session.id)
  expect(ctx.movies.list()).toHaveLength(1)
  expect(ctx.library.files(item.id)).toHaveLength(1)
})
it('previews TV episode matches before adoption and supports manual corrections', async () => {
  const root = join(dir, 'tv')
  file(join(root, 'Custom Show Folder', 'Test.Show.S01E01E02.1080p.WEB-DL.mkv'))
  file(join(root, 'Custom Show Folder', 'unknown.mkv'))
  let session = await ctx.import.review.scan({ kind: 'series', mode: 'adopt', path: root })
  for (const row of session.rows) Object.assign(row, { selected: true, tmdbId: 20, profileId })
  session = await ctx.import.review.preview(session.id, session.rows, 'hardlink')
  expect(ctx.series.list()).toHaveLength(0)
  expect(session.rows.find((r) => r.source.endsWith('unknown.mkv'))!.error).toMatch(
    /choose episode/,
  )
  expect(session.rows.find((r) => !r.source.endsWith('unknown.mkv'))!.episodeKeys).toEqual([
    '1:1',
    '1:2',
  ])
  session.rows.find((r) => r.source.endsWith('unknown.mkv'))!.episodeKeys = ['1:3']
  session = await ctx.import.review.preview(session.id, session.rows, 'hardlink')
  session = await ctx.import.review.commit(session.id)
  expect(session.rows.map((r) => r.error)).toEqual([undefined, undefined])
  const show = ctx.series.list()[0]!
  expect(ctx.series.episodeFiles(show.id).size).toBe(3)
  expect(ctx.library.files(show.id)).toHaveLength(2)
})
it('manual import previews destinations, preserves copy sources and is idempotent', async () => {
  const item = await movie()
  const source = file(join(dir, 'download', 'Test.Movie.2020.1080p.WEB-DL.mkv'))
  let session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'manual',
    path: dirname(source),
    mediaId: item.id,
  })
  session = await ctx.import.review.preview(session.id, session.rows, 'copy')
  expect(existsSync(session.rows[0]!.destination!)).toBe(false)
  session = await ctx.import.review.commit(session.id)
  expect(session.complete).toBe(true)
  expect(existsSync(source)).toBe(true)
  await ctx.import.review.commit(session.id)
  expect(ctx.library.files(item.id)).toHaveLength(1)
})
it('rejects stale sources without transferring files', async () => {
  const item = await movie()
  const source = file(join(dir, 'download', 'a.mkv'))
  const session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'manual',
    path: dirname(source),
    mediaId: item.id,
  })
  await ctx.import.review.preview(session.id, session.rows, 'move')
  writeFileSync(source, 'changed content')
  const result = await ctx.import.review.commit(session.id)
  expect(result.rows[0]!.error).toMatch(/source changed/)
  expect(ctx.library.files(item.id)).toHaveLength(0)
  expect(existsSync(source)).toBe(true)
})
it('rescans moved files and removes only verified missing records, preserving offline roots', async () => {
  const item = await movie()
  const folder = ctx.library.folderOf(item)
  const oldPath = file(join(folder, 'old.mkv'))
  let session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'rescan',
    path: folder,
    mediaId: item.id,
  })
  await ctx.import.review.preview(session.id, session.rows, 'hardlink')
  await ctx.import.review.commit(session.id)
  renameSync(oldPath, join(folder, 'renamed.mkv'))
  session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'rescan',
    path: folder,
    mediaId: item.id,
  })
  expect(session.missing).toHaveLength(1)
  await ctx.import.review.preview(session.id, session.rows, 'hardlink', true)
  await ctx.import.review.commit(session.id)
  expect(ctx.library.files(item.id).map((f) => f.path)).toEqual(['renamed.mkv'])
  rmSync(join(folder, 'renamed.mkv'))
  session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'rescan',
    path: folder,
    mediaId: item.id,
  })
  await ctx.import.review.preview(session.id, [], 'hardlink', true)
  renameSync(folder, `${folder}-offline`)
  await expect(ctx.import.review.commit(session.id)).rejects.toThrow()
  expect(ctx.library.files(item.id)).toHaveLength(1)
})
it('retains placed outcomes after record failure and resumes without transferring again', async () => {
  const item = await movie()
  file(join(dir, 'download', 'a.mkv'))
  const session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'manual',
    path: join(dir, 'download'),
    mediaId: item.id,
  })
  await ctx.import.review.preview(session.id, session.rows, 'move')
  const original = ctx.library.addFile.bind(ctx.library)
  ctx.library.addFile = () => {
    throw new Error('record failed')
  }
  const failed = await ctx.import.review.commit(session.id)
  expect(failed.rows[0]!.status).toBe('placed')
  expect(existsSync(failed.rows[0]!.source)).toBe(true)
  ctx.library.addFile = original
  const resumed = await ctx.import.review.commit(session.id)
  expect(resumed.complete).toBe(true)
  expect(existsSync(resumed.rows[0]!.source)).toBe(false)
  expect(ctx.library.files(item.id)).toHaveLength(1)
})
it('stages a replacement before touching the old file and restores it after placement failure', async () => {
  const source = file(join(dir, 'incoming.mkv'), 'new')
  const dest = file(join(dir, 'existing.mkv'), 'old')
  await expect(
    placeSafely(source, dest, 'copy', '', {
      ...fileSystem,
      copyFile: async () => {
        throw new Error('disk full')
      },
    }),
  ).rejects.toThrow('disk full')
  expect(readFileSync(dest, 'utf8')).toBe('old')
  await expect(
    placeSafely(source, dest, 'copy', '', {
      ...fileSystem,
      rename: async (a, b) => {
        if (
          String(a).includes('.magpie-incoming-') &&
          !String(a).endsWith('.previous') &&
          b === dest
        )
          throw new Error('rename failed')
        return fileSystem.rename(a, b)
      },
    }),
  ).rejects.toThrow('rename failed')
  expect(readFileSync(dest, 'utf8')).toBe('old')
  expect(readFileSync(source, 'utf8')).toBe('new')
})
it('persists review plans across a fresh database connection', async () => {
  const item = await movie()
  file(join(dir, 'download', 'a.mkv'))
  const session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'manual',
    path: join(dir, 'download'),
    mediaId: item.id,
  })
  await ctx.import.review.preview(session.id, session.rows, 'copy')
  const savedPath = join(dir, 'saved.db')
  ctx.database.sqlite.prepare('VACUUM INTO ?').run(savedPath)
  const restoredContext = new Context()
  const database = await restoredContext.plugin(DatabaseService, { path: savedPath })
  const restored = new ReviewService(restoredContext)
  expect(restored.get(session.id).rows[0]!.destination).toContain('Test Movie')
  await database.dispose()
})
it('rejects overlapping episode selections and keeps unmatched files available for review', async () => {
  const root = join(dir, 'tv')
  file(join(root, 'Show', 'Test.Show.S01E01.mkv'))
  file(join(root, 'Show', 'Test.Show.S01E01.mp4'))
  const session = await ctx.import.review.scan({ kind: 'series', mode: 'adopt', path: root })
  for (const row of session.rows) Object.assign(row, { selected: true, tmdbId: 20, profileId })
  const preview = await ctx.import.review.preview(session.id, session.rows, 'hardlink')
  expect(preview.rows.some((r) => r.error?.includes('same episode'))).toBe(true)
})
