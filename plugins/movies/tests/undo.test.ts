// Undo of movie imports, end to end: the journal, the trash and the library records.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
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
import ImportService, { purge } from '@magpiejs/import'
import { operations } from '@magpiejs/import/schema'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import MoviesService from '../src'

let ctx: Context
let dir: string
let movieId: number

const folder = () => join(dir, 'movies', 'Night of the Living Dead (1968)')
const WEB = 'Night of the Living Dead (1968) [WEB-DL-720p].mkv'
const BLURAY = 'Night of the Living Dead (1968) [Bluray-1080p].mkv'

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-undo-'))
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
  await ctx.plugin(MetadataService)
  await ctx.plugin(MoviesService)
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
  // no recycle bin: replaced files wait in Magpie's own trash
  ctx.import.trashDir = join(dir, 'trash')
  return () => rmSync(dir, { recursive: true, force: true })
})

function download(
  title: string,
  quality: string,
  files: Record<string, string>,
  options: { protocol?: 'torrent' | 'usenet'; manual?: boolean } = {},
) {
  const out = join(dir, 'downloads', title)
  mkdirSync(out, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content)
  const now = Date.now()
  return ctx.downloads.db
    .insert(grabs)
    .values({
      mediaId: movieId,
      title,
      quality,
      formatScore: 0,
      protocol: options.protocol ?? 'torrent',
      clientId: 'qbit',
      downloadId: title,
      state: 'import_pending',
      outputPath: out,
      manual: options.manual ?? false,
      grabbedAt: now,
      updatedAt: now,
      lastProgressAt: now,
      release: { guid: title, title, protocol: 'torrent', indexerId: 'x', downloadUrl: '' },
    })
    .returning()
    .get()
}
const WEB_RELEASE = 'Night.of.the.Living.Dead.1968.720p.WEB-DL.x264-GRP'
const BLURAY_RELEASE = 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'
const batchOf = (grabId: number) => {
  const event = ctx.history.list({ mediaId: movieId }).find((e) => e.data.path)
  void grabId
  return event!.data.batchId as string
}
const ops = () => ctx.import.journal.list({ mediaId: movieId })

describe('undo of a new import', () => {
  it('removes the file and its record and leaves the download alone', async () => {
    const grab = download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' })
    await ctx.import.importGrab(grab.id)
    expect(readFileSync(join(folder(), WEB), 'utf8')).toBe('web')
    const [op] = ops()
    expect(op).toMatchObject({ type: 'place', method: 'hardlink', status: 'applied' })
    expect(op!.fingerprint).toMatch(/^3:/)

    const outcome = await ctx.import.undo.undo(op!.id)

    expect(outcome).toMatchObject({ ok: true, warnings: [] })
    expect(existsSync(join(folder(), WEB))).toBe(false)
    expect(readFileSync(join(grab.outputPath!, 'a.mkv'), 'utf8')).toBe('web')
    expect(ctx.library.files(movieId)).toHaveLength(0)
    expect(ctx.import.journal.get(op!.id)).toMatchObject({ status: 'undone' })
    const types = ctx.history.list({ mediaId: movieId }).map((e) => e.type)
    expect(types).toEqual(['import-undone', 'imported'])
    expect(batchOf(grab.id)).toBe(op!.batchId)
  })

  it('cannot be undone twice', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    const [op] = ops()
    await ctx.import.undo.undo(op!.id)
    expect(await ctx.import.undo.undo(op!.id)).toMatchObject({
      ok: false,
      reason: 'already undone',
    })
  })

  it('refuses when the file changed after the import, and changes nothing', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    const [op] = ops()
    const path = join(folder(), WEB)
    // another tool rewrites the file (a copy, so the download is unaffected)
    rmSync(path)
    writeFileSync(path, 'edited!')
    const outcome = await ctx.import.undo.undo(op!.id)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/changed after the import/)
    expect(readFileSync(path, 'utf8')).toBe('edited!')
    expect(ctx.library.files(movieId)).toHaveLength(1)
    expect(await ctx.import.undo.check(op!.id)).toMatchObject({ ok: false })
  })
})

describe('undo of a replacement', () => {
  it('puts the previous file and its record back when the name changed', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    const grab = download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' })
    await ctx.import.importGrab(grab.id)
    expect(readdirSync(folder())).toEqual([BLURAY])
    const [newer, older] = ops()
    expect(newer).toMatchObject({ type: 'place', dest: join(folder(), BLURAY) })
    expect(ctx.import.journal.children(newer!.id)).toMatchObject([
      { type: 'delete', dest: join(folder(), WEB), status: 'applied' },
    ])

    // the newer import blocks undoing the older one
    expect(await ctx.import.undo.undo(older!.id)).toMatchObject({ ok: false })

    const outcome = await ctx.import.undo.undo(newer!.id)

    expect(outcome.ok).toBe(true)
    expect(readdirSync(folder())).toEqual([WEB])
    expect(readFileSync(join(folder(), WEB), 'utf8')).toBe('web')
    expect(ctx.library.files(movieId)).toMatchObject([{ path: WEB, quality: 'webdl-720p' }])
    // what was parked is no longer in the trash
    expect(
      existsSync(ctx.import.trashDir)
        ? readdirSync(ctx.import.trashDir, { recursive: true, withFileTypes: true }).filter((e) =>
            e.isFile(),
          )
        : [],
    ).toHaveLength(0)
    // and the older import can be undone now
    expect((await ctx.import.undo.undo(older!.id)).ok).toBe(true)
    expect(readdirSync(folder())).toEqual([])
  })

  it('restores a same-name replacement from the trash', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'first' }).id)
    const grab = download(
      WEB_RELEASE + '.REPACK',
      'webdl-720p',
      { 'b.mkv': 'second' },
      { manual: true },
    )
    await ctx.import.importGrab(grab.id)
    expect(readFileSync(join(folder(), WEB), 'utf8')).toBe('second')
    const [newer] = ops()
    expect(newer).toMatchObject({ type: 'replace' })
    expect(newer!.trashPath).toContain(ctx.import.trashDir)

    expect((await ctx.import.undo.undo(newer!.id)).ok).toBe(true)

    expect(readFileSync(join(folder(), WEB), 'utf8')).toBe('first')
    expect(ctx.library.files(movieId)).toHaveLength(1)
    expect(ctx.library.files(movieId)[0]!.releaseName).toBe(WEB_RELEASE)
  })

  it('uses the recycle bin the user set, and keeps its files on expiry', async () => {
    ctx.library.saveFileHandling({ recycleBin: join(dir, 'recycle') })
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    await ctx.import.importGrab(download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' }).id)
    const [newer] = ops()
    const parked = ctx.import.journal.children(newer!.id)[0]!.trashPath!
    expect(parked.startsWith(join(dir, 'recycle'))).toBe(true)

    ctx.library.saveFileHandling({ undoRetentionDays: 1 })
    const later = Date.now() + 2 * 24 * 60 * 60_000
    await purge(ctx, ctx.import.journal, ctx.import.trashDir, later)

    expect(ctx.import.journal.get(newer!.id)!.status).toBe('expired')
    expect(existsSync(parked)).toBe(true)
    expect((await ctx.import.undo.undo(newer!.id)).reason).toMatch(/too old/)
  })

  it('refuses when the replaced file is gone from the trash', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    await ctx.import.importGrab(download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' }).id)
    const [newer] = ops()
    rmSync(ctx.import.journal.children(newer!.id)[0]!.trashPath!)
    const outcome = await ctx.import.undo.undo(newer!.id)
    expect(outcome.reason).toMatch(/no longer in the trash/)
    expect(readdirSync(folder())).toEqual([BLURAY])
  })
})

describe('sidecars', () => {
  it('follow a replaced video into the trash and come back with it', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    writeFileSync(join(folder(), WEB.replace('.mkv', '.en.srt')), 'english')
    writeFileSync(join(folder(), WEB.replace('.mkv', '.nfo')), 'not a subtitle')
    await ctx.import.importGrab(download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' }).id)
    expect(readdirSync(folder()).sort()).toEqual([BLURAY, WEB.replace('.mkv', '.nfo')].sort())
    const [newer] = ops()
    // one thing to undo, however many files it moved
    expect(ops().map((o) => o.id)).not.toContain(ctx.import.journal.children(newer!.id)[0]!.id)
    expect(ctx.import.journal.children(newer!.id)).toHaveLength(2)

    expect(await ctx.import.undo.undo(newer!.id)).toMatchObject({ ok: true, warnings: [] })

    expect(readdirSync(folder()).sort()).toEqual(
      [WEB, WEB.replace('.mkv', '.en.srt'), WEB.replace('.mkv', '.nfo')].sort(),
    )
    expect(readFileSync(join(folder(), WEB.replace('.mkv', '.en.srt')), 'utf8')).toBe('english')
  })

  it('that were recreated since are left alone while the video still comes back', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    const subtitle = join(folder(), WEB.replace('.mkv', '.en.srt'))
    writeFileSync(subtitle, 'original')
    await ctx.import.importGrab(download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' }).id)
    // a subtitle provider wrote a new one at the old name in the meantime
    writeFileSync(subtitle, 'fresh')
    const [newer] = ops()

    const outcome = await ctx.import.undo.undo(newer!.id)

    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toHaveLength(1)
    expect(outcome.warnings[0]).toMatch(/en\.srt.*exists again/)
    expect(readFileSync(subtitle, 'utf8')).toBe('fresh')
    expect(readFileSync(join(folder(), WEB), 'utf8')).toBe('web')
  })
})

describe('moves (usenet)', () => {
  it('go back to the download folder', async () => {
    const grab = download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }, { protocol: 'usenet' })
    await ctx.import.importGrab(grab.id)
    expect(existsSync(join(grab.outputPath!, 'a.mkv'))).toBe(false)
    const [op] = ops()
    expect(op).toMatchObject({ type: 'place', method: 'move' })

    expect((await ctx.import.undo.undo(op!.id)).ok).toBe(true)

    expect(readFileSync(join(grab.outputPath!, 'a.mkv'), 'utf8')).toBe('web')
    expect(existsSync(join(folder(), WEB))).toBe(false)
  })

  it('are refused, with the reason, once the download folder is gone', async () => {
    const grab = download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }, { protocol: 'usenet' })
    await ctx.import.importGrab(grab.id)
    rmSync(grab.outputPath!, { recursive: true })
    const [op] = ops()
    const outcome = await ctx.import.undo.undo(op!.id)
    expect(outcome.reason).toMatch(/download folder .* no longer exists/)
    expect(readFileSync(join(folder(), WEB), 'utf8')).toBe('web')
  })
})

describe('the trash', () => {
  it('expires old operations and frees their files, keeping what is newer', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    await ctx.import.importGrab(download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' }).id)
    const [newer, older] = ops()
    const parked = ctx.import.journal.children(newer!.id)[0]!.trashPath!
    expect(existsSync(parked)).toBe(true)

    // nothing is old enough yet
    await purge(ctx, ctx.import.journal, ctx.import.trashDir)
    expect(existsSync(parked)).toBe(true)

    const result = await purge(
      ctx,
      ctx.import.journal,
      ctx.import.trashDir,
      Date.now() + 8 * 86_400_000,
    )

    expect(result.removed).toBe(1)
    expect(existsSync(parked)).toBe(false)
    expect(ctx.import.journal.get(newer!.id)!.status).toBe('expired')
    expect(ctx.import.journal.get(older!.id)!.status).toBe('expired')
    expect(ctx.import.journal.children(newer!.id)[0]!.status).toBe('expired')
    // the library is untouched
    expect(readdirSync(folder())).toEqual([BLURAY])
  })

  it('purges the oldest files first when it grows past the size cap', async () => {
    await ctx.import.importGrab(
      download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'x'.repeat(2048) }).id,
    )
    await ctx.import.importGrab(
      download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'y'.repeat(4096) }).id,
    )
    const [newer] = ops()
    // a 1-byte cap (in GB) can be met only by emptying the trash
    ctx.library.saveFileHandling({ undoMaxGb: 1 / 1024 ** 3 })
    await purge(ctx, ctx.import.journal, ctx.import.trashDir)
    expect(ctx.import.journal.get(newer!.id)!.status).toBe('expired')
  })

  it('removes files nothing refers to, but not fresh ones', async () => {
    const stray = join(ctx.import.trashDir, 'Some Movie', 'stray.mkv')
    const fresh = join(ctx.import.trashDir, 'Some Movie', 'fresh.mkv')
    mkdirSync(join(ctx.import.trashDir, 'Some Movie'), { recursive: true })
    writeFileSync(stray, 'x')
    writeFileSync(fresh, 'x')
    const old = new Date(Date.now() - 3 * 86_400_000)
    utimesSync(stray, old, old)
    // a stray file's ctime is its creation time here, so look far enough ahead
    const result = await purge(
      ctx,
      ctx.import.journal,
      ctx.import.trashDir,
      Date.now() + 2 * 86_400_000,
    )
    expect(result.removed).toBe(2)
    expect(existsSync(stray)).toBe(false)
    expect(existsSync(join(ctx.import.trashDir, 'Some Movie'))).toBe(false)
    void fresh
  })

  it('is not used when undo is turned off', async () => {
    ctx.library.saveFileHandling({ undoRetentionDays: 0 })
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    await ctx.import.importGrab(download(BLURAY_RELEASE, 'bluray-1080p', { 'b.mkv': 'bluray!' }).id)
    expect(ops()).toHaveLength(0)
    expect(existsSync(ctx.import.trashDir)).toBe(false)
    expect(readdirSync(folder())).toEqual([BLURAY])
    expect(ctx.history.list({ mediaId: movieId })[0]!.data.batchId).toBeUndefined()
  })
})

describe('crash safety', () => {
  const insert = (values: Partial<typeof operations.$inferInsert> & { dest: string }) =>
    ctx.import.journal.db
      .insert(operations)
      .values({
        batchId: 'b',
        mediaId: movieId,
        type: 'place',
        status: 'pending',
        createdAt: Date.now(),
        ...values,
      })
      .returning()
      .get()

  it('keeps a change that happened and abandons one that did not', async () => {
    mkdirSync(folder(), { recursive: true })
    const there = join(folder(), WEB)
    writeFileSync(there, 'web')
    const happened = insert({ dest: there, source: '/x/a.mkv', method: 'hardlink' })
    const missing = insert({
      dest: join(folder(), 'never.mkv'),
      source: '/x/b.mkv',
      method: 'copy',
    })
    const deleted = insert({ type: 'delete', dest: join(folder(), 'gone.mkv') })
    const stillThere = insert({ type: 'delete', dest: there })

    expect(await ctx.import.journal.recover()).toBe(4)

    const status = (id: number) => ctx.import.journal.get(id)!.status
    expect(status(happened.id)).toBe('applied')
    expect(ctx.import.journal.get(happened.id)!.fingerprint).toMatch(/^3:/)
    expect(status(missing.id)).toBe('abandoned')
    expect(status(deleted.id)).toBe('applied')
    expect(status(stillThere.id)).toBe('abandoned')
    // a delete whose parked file is unknown cannot be undone
    expect((await ctx.import.undo.undo(deleted.id)).reason).toMatch(/was not kept/)
  })

  it('leaves recent operations alone when asked to', async () => {
    const op = insert({ dest: join(folder(), WEB) })
    expect(await ctx.import.journal.recover(60_000)).toBe(0)
    expect(ctx.import.journal.get(op.id)!.status).toBe('pending')
  })

  it('records an undo that was interrupted, and can be retried', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    const [op] = ops()
    ctx.import.journal.setStatus(op!.id, 'undo_failed', { error: 'undo was interrupted' })
    expect((await ctx.import.undo.undo(op!.id)).ok).toBe(true)
    expect(ctx.import.journal.get(op!.id)!.status).toBe('undone')
  })

  it('removes the journal with the item', async () => {
    await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
    expect(ops()).toHaveLength(1)
    ctx.library.remove(movieId)
    const left = ctx.import.journal.db
      .select()
      .from(operations)
      .where(eq(operations.mediaId, movieId))
      .all()
    expect(left).toHaveLength(0)
  })
})

describe('batches', () => {
  it('undo newest first and carry on past the ones that cannot be undone', async () => {
    const first = await (async () => {
      await ctx.import.importGrab(download(WEB_RELEASE, 'webdl-720p', { 'a.mkv': 'web' }).id)
      return ops()[0]!
    })()
    // two more rows sharing the first one's batch, as a review commit would write
    const db = ctx.import.journal.db
    const extra = db
      .insert(operations)
      .values({
        batchId: first.batchId,
        mediaId: movieId,
        type: 'place',
        source: '/nowhere/x.mkv',
        dest: join(folder(), 'Other.mkv'),
        method: 'copy',
        status: 'applied',
        fingerprint: '1:1:x',
        createdAt: Date.now(),
      })
      .returning()
      .get()
    writeFileSync(extra.dest, 'x')

    const outcomes = await ctx.import.undo.undoBatch(first.batchId)

    expect(outcomes.map((o) => [o.id, o.ok])).toEqual([
      [extra.id, false], // fingerprint does not match
      [first.id, true],
    ])
    expect(ctx.import.journal.get(first.id)!.status).toBe('undone')
    expect(statSync(extra.dest).size).toBe(1)
    expect(await ctx.import.undo.batchStatus(first.batchId)).toMatchObject({
      total: 2,
      undone: 1,
      undoable: 0,
    })
  })
})
