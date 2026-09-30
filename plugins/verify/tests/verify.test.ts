import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grabs } from '@magpiejs/downloads'
import HistoryService from '@magpiejs/history'
import MediaTools from '@magpiejs/media-tools'
import MoviesService from '@magpiejs/movies'
import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Verify from '../src'

let dir: string
let ctx: Context
let movieId: number

const FACTS = {
  format: { format_name: 'matroska,webm', duration: '5400' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 800 },
    { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 6, tags: { language: 'eng' } },
  ],
}

/** A stand-in for ffprobe: `bad` files fail, `novideo` files have only audio, `hung` times out. */
function fakeFfprobe(path: string, facts: unknown = FACTS) {
  const audioOnly = { ...FACTS, streams: FACTS.streams.slice(1) }
  writeFileSync(join(dir, 'facts.json'), JSON.stringify(facts))
  writeFileSync(join(dir, 'audio.json'), JSON.stringify(audioOnly))
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "-version" ]; then echo "ffprobe version 7.1 Copyright"; exit 0; fi
for last; do :; done
case "$last" in *bad*) exit 1;; *novideo*) cat '${join(dir, 'audio.json')}'; exit 0;; esac
cat '${join(dir, 'facts.json')}'
`,
  )
  chmodSync(path, 0o755)
}

async function boot(options: { ffprobe?: boolean; facts?: unknown } = {}) {
  ctx = await createTestContext({ calendar: false })
  await ctx.plugin(HistoryService)
  await ctx.plugin(MoviesService)
  await ctx.plugin(MediaTools)
  const binary = join(dir, 'ffprobe')
  fakeFfprobe(binary, options.facts)
  await ctx.mediaTools.save({ ffprobe: options.ffprobe === false ? join(dir, 'nope') : binary })
  await ctx.plugin(Verify)
  // the test files are a few bytes, which is far too little for any real bitrate
  ctx.verify.save({ modes: { bitrate: 'off' } })
  const root = ctx.library.addRootFolder(join(dir, 'movies'), 'movie')
  movieId = ctx.library.add({
    kind: 'movie',
    title: 'Night of the Living Dead',
    year: 1968,
    externalIds: {},
    primaryProvider: 'none',
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: root.id,
    folder: 'Night of the Living Dead (1968)',
  }).id
  ctx.library.saveFileHandling({ recycleBin: join(dir, 'recycle') })
}

function download(
  title: string,
  files: Record<string, number>,
  options: { manual?: boolean; sizeBytes?: number } = {},
) {
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
      quality: 'bluray-1080p',
      formatScore: 0,
      protocol: 'torrent',
      clientId: 'qbit',
      downloadId: title,
      state: 'import_pending',
      outputPath: out,
      sizeBytes: options.sizeBytes ?? null,
      manual: options.manual ?? false,
      grabbedAt: now,
      updatedAt: now,
      lastProgressAt: now,
      release: { guid: title, title, protocol: 'torrent', indexerId: 'x', downloadUrl: '' },
    })
    .returning()
    .get()
}

const TITLE = 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'
const rejected = () => ctx.verify.recent().filter((r) => r.outcome === 'rejected')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-verify-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('verify: rejecting', () => {
  it('rejects a download that is only a program, before anything is placed', async () => {
    await boot()
    const grab = download(TITLE, { 'movie.exe': 3000 })
    await ctx.import.importGrab(grab.id)

    expect(ctx.downloads.get(grab.id)).toMatchObject({ state: 'removed' })
    expect(ctx.downloads.blocklisted(movieId)[0]!.reason).toContain('program or script')
    expect(ctx.library.files(movieId)).toEqual([])
    expect(ctx.history.list({ mediaId: movieId }).map((e) => e.type)).toContain('import-rejected')
    expect(rejected()).toHaveLength(1)
  })

  it('rejects a program hidden next to a real video', async () => {
    await boot()
    const grab = download(TITLE, { 'movie.mkv': 4000, 'README.scr': 10 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('removed')
  })

  it('rejects a download that is only archives', async () => {
    await boot()
    const grab = download(TITLE, { 'movie.rar': 3000, 'movie.r00': 3000 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('removed')
    expect(ctx.downloads.blocklisted(movieId)[0]!.reason).toContain('only archives')
  })

  it('rejects a video ffprobe cannot read', async () => {
    await boot()
    const grab = download(TITLE, { 'bad.mkv': 4000 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('removed')
    expect(ctx.downloads.blocklisted(movieId)[0]!.reason).toContain('unreadable')
  })

  it('rejects a video with no video stream', async () => {
    await boot()
    const grab = download(TITLE, { 'novideo.mkv': 4000 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('removed')
  })

  it('leaves a manual grab alone but records the warning', async () => {
    await boot()
    const grab = download(TITLE, { 'bad.mkv': 4000 }, { manual: true })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
    expect(ctx.verify.forGrab(grab.id)).toMatchObject({ outcome: 'warned' })
  })
})

describe('verify: passing and warning', () => {
  it('imports a good download and records its facts', async () => {
    await boot()
    const grab = download(TITLE, { 'movie.mkv': 4000 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
    const result = ctx.verify.forGrab(grab.id)!
    expect(result.outcome).toBe('passed')
    expect(result.files[0]!.facts?.video).toMatchObject({ codec: 'h264', width: 1920 })
  })

  it('warns, without rejecting, about a fake label', async () => {
    await boot()
    ctx.verify.save({ modes: {} })
    const grab = download('Night.of.the.Living.Dead.1968.2160p.BluRay.x265-GRP', {
      'movie.mkv': 4000,
    })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
    const result = ctx.verify.forGrab(grab.id)!
    expect(result.outcome).toBe('warned')
    const checks = result.findings.map((f) => (f.detail as { check: string }).check)
    expect(checks).toEqual(expect.arrayContaining(['resolution', 'codec', 'bitrate']))
    expect(result.findings.every((f) => f.severity === 'warn')).toBe(true)
  })

  it('warns when the files are much smaller than the release', async () => {
    await boot()
    const grab = download(TITLE, { 'movie.mkv': 4000 }, { sizeBytes: 4 * 1024 ** 3 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.verify.forGrab(grab.id)!.findings.map((f) => f.reason)[0]).toContain('release was')
  })

  it('checks the runtime against the metadata, leaving named editions longer', async () => {
    await boot()
    let runtime = 120
    ctx.verify.runtime(() => runtime)
    const grab = download(TITLE, { 'movie.mkv': 4000 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.verify.forGrab(grab.id)!.findings[0]!.reason).toContain('runs 90 min')

    const extended = download('Night.of.the.Living.Dead.1968.Extended.Cut.1080p.BluRay.x264-GRP', {
      'movie.mkv': 4000,
    })
    runtime = 80
    await ctx.import.importGrab(extended.id)
    expect(ctx.verify.forGrab(extended.id)!.outcome).toBe('passed')
  })
})

describe('verify: policy', () => {
  it('turns a check off, or up to reject', async () => {
    await boot()
    ctx.verify.save({ modes: { executable: 'off', bitrate: 'off' } })
    const exe = download(TITLE, { 'movie.mkv': 4000, 'x.exe': 10 })
    await ctx.import.importGrab(exe.id)
    expect(ctx.downloads.get(exe.id)!.state).toBe('imported')

    ctx.verify.save({ modes: { bitrate: 'reject', resolution: 'off', codec: 'off' } })
    const low = download('Night.of.the.Living.Dead.1968.2160p.BluRay.x265-GRP', {
      'movie.mkv': 4000,
    })
    await ctx.import.importGrab(low.id)
    expect(ctx.downloads.get(low.id)!.state).toBe('removed')
  })

  it('keeps the policy across a restart and ignores bad values', async () => {
    await boot()
    ctx.verify.save({ modes: { size: 'reject', bogus: 'explode' as never }, durationTolerance: 5 })
    expect(ctx.verify.policy()).toEqual({ modes: { size: 'reject' }, durationTolerance: 0.1 })
    expect(ctx.verify.list().find((c) => c.name === 'size')!.mode).toBe('reject')
  })

  it('skips probe checks when ffprobe is missing, and still runs the others', async () => {
    await boot({ ffprobe: false })
    const ok = download(TITLE, { 'bad.mkv': 4000 })
    await ctx.import.importGrab(ok.id)
    expect(ctx.downloads.get(ok.id)!.state).toBe('imported')

    const exe = download('Another.Movie.2000.1080p.BluRay.x264-GRP', { 'movie.exe': 10 })
    await ctx.import.importGrab(exe.id)
    expect(ctx.downloads.get(exe.id)!.state).toBe('removed')
  })

  it('does not let a broken check block an import', async () => {
    await boot()
    ctx.verify.check('broken', () => {
      throw new Error('boom')
    })
    const grab = download(TITLE, { 'movie.mkv': 4000 })
    await ctx.import.importGrab(grab.id)
    expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
  })
})
