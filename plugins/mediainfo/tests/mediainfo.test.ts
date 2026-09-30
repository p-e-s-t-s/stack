import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MediaTools from '@magpiejs/media-tools'
import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MediaInfo from '../src'

const FACTS = {
  format: { format_name: 'matroska,webm', duration: '5400' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 },
    { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 6, tags: { language: 'eng' } },
    { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'fre' } },
  ],
}

let dir: string
let ctx: Context
let ffprobe: string
let log: string

/** A stand-in for ffprobe: answers -version, logs each probed path, fails on `bad` files. */
function fakeFfprobe(path: string) {
  writeFileSync(join(dir, 'facts.json'), JSON.stringify(FACTS))
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "-version" ]; then echo "ffprobe version 7.1 Copyright"; exit 0; fi
for last; do :; done
echo "$last" >> '${log}'
case "$last" in *bad*) exit 1;; esac
cat '${join(dir, 'facts.json')}'
`,
  )
  chmodSync(path, 0o755)
}

const probed = () => {
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function boot(binary = ffprobe) {
  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(MediaTools)
  await ctx.mediaTools.save({ ffprobe: binary })
  await ctx.plugin(MediaInfo)
  return ctx
}

let n = 0
function addFile(name = 'movie.mkv', content = 'video') {
  const item = ctx.library.add({
    kind: 'movie',
    title: `Movie ${++n}`,
    externalIds: {},
    primaryProvider: 'none',
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: (
      ctx.library.rootFolders('movie')[0] ?? ctx.library.addRootFolder(join(dir, 'lib'), 'movie')
    ).id,
    folder: `movie-${n}`,
  })
  mkdirSync(join(dir, 'lib', item.folder), { recursive: true })
  writeFileSync(join(dir, 'lib', item.folder, name), content)
  const file = ctx.library.addFile({
    mediaId: item.id,
    path: name,
    size: content.length,
    quality: 'bluray-1080p',
    formatScore: 0,
    languages: ['en'],
    releaseName: null,
    releaseGroup: null,
    revision: { version: 1, real: 0, proper: false, repack: false },
  })
  return { item, file, path: join(dir, 'lib', item.folder, name) }
}

/** Runs queued jobs until none are left. */
async function drain() {
  for (let i = 0; i < 5; i++) await ctx.jobs.tick()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-mediainfo-'))
  log = join(dir, 'probed.log')
  ffprobe = join(dir, 'ffprobe')
  fakeFfprobe(ffprobe)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('mediainfo', () => {
  it('probes a file when it is added and keeps the facts', async () => {
    await boot()
    const { file } = addFile()
    await drain()
    const info = ctx.mediainfo.get(file.id)!
    expect(info.error).toBeNull()
    expect(info.facts?.video).toMatchObject({ codec: 'hevc', height: 2160 })
    expect(info.facts?.audio[0]).toMatchObject({ codec: 'eac3', language: 'en' })
    expect(info.facts?.subtitles[0]).toMatchObject({ language: 'fr' })
  })

  it('does not probe an unchanged file again, but does probe a changed one', async () => {
    await boot()
    const { file, path } = addFile()
    await drain()
    expect(probed()).toHaveLength(1)

    await ctx.mediainfo.reconcile()
    await drain()
    expect(probed()).toHaveLength(1)

    writeFileSync(path, 'a different video')
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    await ctx.mediainfo.reconcile()
    await drain()
    expect(probed()).toHaveLength(2)
    expect(ctx.mediainfo.get(file.id)!.fingerprint).toContain(':')
  })

  it('records why a file could not be read and does not retry it straight away', async () => {
    await boot()
    const { file } = addFile('bad.mkv')
    await drain()
    const info = ctx.mediainfo.get(file.id)!
    expect(info.facts).toBeNull()
    expect(info.error).toMatch(/media tool failed/)

    await ctx.mediainfo.reconcile()
    await drain()
    expect(probed()).toHaveLength(1)

    // an error older than the retry window is tried again
    ctx.mediainfo.now = () => Date.now() + 8 * 24 * 60 * 60_000
    await ctx.mediainfo.reconcile()
    await drain()
    expect(probed()).toHaveLength(2)
  })

  it('records nothing while ffprobe is missing, then catches up once it works', async () => {
    await boot(join(dir, 'missing-ffprobe'))
    const { file } = addFile()
    await drain()
    expect(ctx.mediainfo.get(file.id)).toBeUndefined()
    expect(ctx.jobs.list({ status: ['failed'] })).toHaveLength(0)

    await ctx.mediaTools.save({ ffprobe })
    await drain()
    expect(ctx.mediainfo.get(file.id)?.facts?.video?.height).toBe(2160)
  })

  it('drops the record with the file', async () => {
    await boot()
    const { file } = addFile()
    await drain()
    ctx.library.removeFile(file.id)
    expect(ctx.mediainfo.get(file.id)).toBeUndefined()
  })

  it('ignores a file record that points outside the item folder', async () => {
    await boot()
    const { file } = addFile()
    await drain()
    ctx.library.updateFile(file.id, { path: '../../outside.mkv' })
    expect(await ctx.mediainfo.ensure(file.id, undefined, true)).toBeUndefined()
  })

  it('lists the files of an item with what is known about each', async () => {
    await boot()
    const { item, file } = addFile()
    await drain()
    const [entry] = ctx.mediainfo.forMedia(item.id)
    expect(entry!.file.id).toBe(file.id)
    expect(entry!.info?.facts?.container).toBe('matroska,webm')
  })

  it('shares one probe between concurrent requests for a file', async () => {
    await boot()
    const { file } = addFile()
    await Promise.all([ctx.mediainfo.ensure(file.id), ctx.mediainfo.ensure(file.id)])
    expect(probed()).toHaveLength(1)
  })
})
