import { dirname, join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService from '@magpiejs/downloads'
import HistoryService from '@magpiejs/history'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import MoviesService from '@magpiejs/movies'
import SeriesService from '@magpiejs/series'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import ImportService from '../src'

let ctx: Context
let dir: string
let profileId: number
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-review-undo-'))
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
  await ctx.plugin(HistoryService)
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
  ctx.import.trashDir = join(dir, 'trash')
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

async function manualImport(
  source: string,
  options: { replace?: boolean; transfer?: 'copy' | 'move' | 'hardlink' } = {},
) {
  const item = ctx.movies.list()[0]!
  let session = await ctx.import.review.scan({
    kind: 'movie',
    mode: 'manual',
    path: dirname(source),
    mediaId: item.id,
  })
  session.rows[0]!.replace = options.replace ?? false
  session = await ctx.import.review.preview(session.id, session.rows, options.transfer ?? 'copy')
  return ctx.import.review.commit(session.id)
}

describe('undo of a manual import', () => {
  it('journals a new file under the commit, and undoes the commit', async () => {
    const item = await movie()
    const source = file(join(dir, 'download', 'Test.Movie.2020.1080p.WEB-DL.mkv'), 'one')
    const session = await manualImport(source)
    const row = session.rows[0]!
    expect(row.error).toBeUndefined()
    const [op] = ctx.import.journal.list({ mediaId: item.id })
    expect(op).toMatchObject({
      type: 'place',
      method: 'copy',
      status: 'applied',
      dest: row.destination,
    })
    expect(row.operationId).toBe(op!.id)
    // the history event says which batch to undo
    expect(ctx.history.list({ mediaId: item.id })[0]!.data).toMatchObject({
      batchId: op!.batchId,
      operationId: op!.id,
    })

    const outcomes = await ctx.import.undo.undoBatch(op!.batchId)

    expect(outcomes.map((o) => o.ok)).toEqual([true])
    expect(existsSync(row.destination!)).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(ctx.library.files(item.id)).toHaveLength(0)
  })

  it('keeps the previous file in the trash and brings it back', async () => {
    const item = await movie()
    const folder = ctx.library.folderOf(item)
    const existing = file(join(folder, 'Test Movie (2020) [WEB-DL-1080p].mkv'), 'old')
    const source = file(join(dir, 'download', 'Test.Movie.2020.1080p.WEB-DL.mkv'), 'new!')
    // a sidecar next to the old file is left where it is, as the new file has the same name
    const subtitle = file(existing.replace('.mkv', '.en.srt'), 'subs')
    ctx.library.addFile({
      mediaId: item.id,
      path: 'Test Movie (2020) [WEB-DL-1080p].mkv',
      size: 3,
      quality: 'webdl-1080p',
      formatScore: 0,
      languages: [],
      releaseName: 'Old.Release',
      releaseGroup: null,
      revision: { version: 1, real: 0, proper: false, repack: false },
    })

    const session = await manualImport(source, { replace: true })

    expect(session.rows[0]!.error).toBeUndefined()
    expect(session.rows[0]!.destination).toBe(existing)
    expect(readFileSync(existing, 'utf8')).toBe('new!')
    const [op] = ctx.import.journal.list({ mediaId: item.id })
    expect(op).toMatchObject({ type: 'replace', status: 'applied' })
    expect(op!.trashPath).toContain(ctx.import.trashDir)
    expect(readFileSync(op!.trashPath!, 'utf8')).toBe('old')

    expect((await ctx.import.undo.undo(op!.id)).ok).toBe(true)

    expect(readFileSync(existing, 'utf8')).toBe('old')
    expect(readFileSync(subtitle, 'utf8')).toBe('subs')
    expect(ctx.library.files(item.id)).toMatchObject([
      { path: 'Test Movie (2020) [WEB-DL-1080p].mkv', releaseName: 'Old.Release' },
    ])
  })

  it('abandons the record of an import that failed before placing anything', async () => {
    const item = await movie()
    const source = file(join(dir, 'download', 'Test.Movie.2020.1080p.WEB-DL.mkv'), 'one')
    let session = await ctx.import.review.scan({
      kind: 'movie',
      mode: 'manual',
      path: dirname(source),
      mediaId: item.id,
    })
    session = await ctx.import.review.preview(session.id, session.rows, 'copy')
    // the destination appears after the preview and is not a replacement
    file(session.rows[0]!.destination!, 'in the way')
    session = await ctx.import.review.commit(session.id)
    expect(session.rows[0]!.error).toMatch(/destination exists/)
    expect(ctx.import.journal.list({ mediaId: item.id })).toHaveLength(0)
    expect(readFileSync(session.rows[0]!.destination!, 'utf8')).toBe('in the way')
  })
})
