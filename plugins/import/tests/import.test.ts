import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService, { grabs } from '@magpiejs/downloads'
import HistoryService from '@magpiejs/history'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import ImportService, { fileSystem } from '../src'

let ctx: Context
let dir: string
let movieId: number

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-import-'))
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(ImportService)
  await ctx.plugin(HistoryService)
  const root = ctx.library.addRootFolder(join(dir, 'movies'), 'movie')
  movieId = ctx.library.add({
    kind: 'movie',
    title: 'Night of the Living Dead',
    year: 1968,
    externalIds: {},
    primaryProvider: 'tmdb',
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: root.id,
    folder: 'Night of the Living Dead (1968)',
  }).id
  ctx.library.saveNaming({ recycleBin: join(dir, 'recycle') })
  return () => rmSync(dir, { recursive: true, force: true })
})

/** A finished download on disk plus its grab row, as the downloads plugin would leave it. */
function download(title: string, quality: string, files: Record<string, number>) {
  const out = join(dir, 'downloads', title)
  mkdirSync(out, { recursive: true })
  for (const [name, size] of Object.entries(files))
    writeFileSync(join(out, name), Buffer.alloc(size))
  const now = Date.now()
  return ctx.downloads.db
    .insert(grabs)
    .values({
      mediaId: movieId,
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
}

const moviePath = (name: string) => join(dir, 'movies', 'Night of the Living Dead (1968)', name)

describe('import', () => {
  it('hardlinks the main video with a clean name and records it', async () => {
    const grab = download('Night.of.the.Living.Dead.1968.720p.WEB-DL.x264-GRP', 'webdl-720p', {
      'notld.720p.mkv': 3000,
      'notld.sample.mkv': 100,
      'info.nfo': 10,
    })
    await ctx.import.importGrab(grab.id)

    const dest = moviePath('Night of the Living Dead (1968) [WEB-DL-720p].mkv')
    expect(statSync(dest).ino).toBe(statSync(join(grab.outputPath!, 'notld.720p.mkv')).ino) // same file: hardlink
    expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
    expect(ctx.library.files(movieId)).toMatchObject([
      {
        path: 'Night of the Living Dead (1968) [WEB-DL-720p].mkv',
        quality: 'webdl-720p',
        size: 3000,
        releaseGroup: 'GRP',
      },
    ])
    expect(ctx.history.list({ mediaId: movieId }).map((e) => e.type)).toEqual(['imported'])
  })

  it('replaces a worse file and moves it to the recycle bin', async () => {
    await ctx.import.importGrab(
      download('Night.of.the.Living.Dead.1968.720p.WEB-DL.x264-GRP', 'webdl-720p', {
        'a.mkv': 3000,
      }).id,
    )
    await ctx.import.importGrab(
      download('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', 'bluray-1080p', {
        'b.mkv': 8000,
      }).id,
    )

    expect(readdirSync(join(dir, 'movies', 'Night of the Living Dead (1968)'))).toEqual([
      'Night of the Living Dead (1968) [Bluray-1080p].mkv',
    ])
    expect(
      existsSync(
        join(
          dir,
          'recycle',
          'Night of the Living Dead (1968)',
          'Night of the Living Dead (1968) [WEB-DL-720p].mkv',
        ),
      ),
    ).toBe(true)
    expect(ctx.library.files(movieId).map((f) => f.quality)).toEqual(['bluray-1080p'])
  })

  it('refuses downloads that are no longer an upgrade, and missing paths', async () => {
    await ctx.import.importGrab(
      download('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', 'bluray-1080p', {
        'b.mkv': 8000,
      }).id,
    )
    const worse = download('Night.of.the.Living.Dead.1968.720p.WEB-DL.x264-GRP', 'webdl-720p', {
      'a.mkv': 3000,
    })
    await ctx.import.importGrab(worse.id)
    expect(ctx.downloads.get(worse.id)).toMatchObject({
      state: 'import_failed',
      error: 'not an upgrade over the existing file',
    })

    const gone = download('Night.of.the.Living.Dead.1968.2160p.WEB-DL.x265-GRP', 'webdl-2160p', {})
    rmSync(gone.outputPath!, { recursive: true })
    await ctx.import.importGrab(gone.id)
    expect(ctx.downloads.get(gone.id)!.error).toMatch(
      /does not exist \(check that Magpie and the download client see the same paths\)/,
    )
    expect(ctx.history.list({ mediaId: movieId }).map((e) => e.type)).toEqual([
      'import-failed',
      'import-failed',
      'imported',
    ])
  })

  it('copies when a hardlink is not possible across filesystems', async () => {
    ctx.import.fs = {
      ...fileSystem,
      link: async () => {
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
      },
    }
    const grab = download('Night.of.the.Living.Dead.1968.720p.WEB-DL.x264-GRP', 'webdl-720p', {
      'a.mkv': 3000,
    })
    const done: string[] = []
    ctx.on('import/completed', (_, __, result) => void done.push(result.method))
    await ctx.import.importGrab(grab.id)
    const dest = moviePath('Night of the Living Dead (1968) [WEB-DL-720p].mkv')
    expect(statSync(dest).ino).not.toBe(statSync(join(grab.outputPath!, 'a.mkv')).ino)
    expect(done).toEqual(['copy'])
  })
})
