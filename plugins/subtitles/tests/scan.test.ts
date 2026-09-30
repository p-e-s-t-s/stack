import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MediaInfo from '@magpiejs/mediainfo'
import MediaTools from '@magpiejs/media-tools'
import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Subtitles from '../src'

const SRT =
  '1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nGeneral Kenobi\n'

const FACTS = {
  format: { format_name: 'matroska,webm', duration: '5400' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'eng' } },
    {
      index: 2,
      codec_type: 'subtitle',
      codec_name: 'subrip',
      tags: { language: 'fre' },
      disposition: { forced: 0, hearing_impaired: 0 },
    },
  ],
}

let dir: string
let ctx: Context
let ffprobe: string

/** A stand-in for ffprobe that answers -version and fails for files named `bad`. */
function fakeFfprobe() {
  ffprobe = join(dir, 'ffprobe')
  writeFileSync(join(dir, 'facts.json'), JSON.stringify(FACTS))
  writeFileSync(
    ffprobe,
    `#!/bin/sh
if [ "$1" = "-version" ]; then echo "ffprobe version 7.1 Copyright"; exit 0; fi
for last; do :; done
case "$last" in *bad*) exit 1;; esac
cat '${join(dir, 'facts.json')}'
`,
  )
  chmodSync(ffprobe, 0o755)
}

async function boot(binary = ffprobe) {
  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(MediaTools)
  await ctx.mediaTools.save({ ffprobe: binary })
  await ctx.plugin(MediaInfo)
  await ctx.plugin(Subtitles)
  return ctx
}

function addMovie(name = 'movie.mkv') {
  const item = ctx.library.add({
    kind: 'movie',
    title: 'Movie',
    externalIds: {},
    primaryProvider: 'none',
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: ctx.library.addRootFolder(join(dir, 'lib'), 'movie').id,
    folder: 'movie',
  })
  mkdirSync(join(dir, 'lib', 'movie'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'movie', name), 'video')
  writeFileSync(join(dir, 'lib', 'movie', 'movie.en.srt'), SRT)
  const file = ctx.library.addFile({
    mediaId: item.id,
    path: name,
    size: 5,
    quality: 'bluray-1080p',
    formatScore: 0,
    languages: ['en'],
    releaseName: null,
    releaseGroup: null,
    revision: { version: 1, real: 0, proper: false, repack: false },
  })
  return { file, path: join(dir, 'lib', 'movie', name) }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-subs-'))
  fakeFfprobe()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('subtitle scan', () => {
  it('lists embedded tracks from mediainfo and sidecar files from disk', async () => {
    await boot()
    const { file } = addMovie()
    const view = await ctx.subtitles.scan(file.id)
    const rows = view!.inventory
    expect(rows.map((r) => r.location).sort()).toEqual(['movie.en.srt', 'stream:2'])
    expect(rows.find((r) => r.location === 'stream:2')).toMatchObject({
      embedded: true,
      language: 'fr',
      format: 'subrip',
    })
    expect(rows.find((r) => r.location === 'movie.en.srt')).toMatchObject({
      embedded: false,
      language: 'en',
      valid: true,
    })
    expect(view!.probeError).toBeNull()
  })

  it('probes once: subtitles reuses the facts mediainfo already has', async () => {
    await boot()
    const { file } = addMovie()
    await ctx.mediainfo.ensure(file.id)
    let probes = 0
    const real = ctx.mediainfo.probeFile
    ctx.mediainfo.probeFile = (...args) => (probes++, real(...args))
    await ctx.subtitles.scan(file.id)
    await ctx.subtitles.scan(file.id)
    expect(probes).toBe(0)
  })

  it('records why a file could not be read', async () => {
    await boot()
    const { file } = addMovie('bad.mkv')
    await ctx.subtitles.scan(file.id)
    expect(ctx.subtitles.files().find((v) => v.file.id === file.id)!.probeError).toMatch(
      /media tool failed/,
    )
  })

  it('scans again after the file changes', async () => {
    await boot()
    const { file, path } = addMovie()
    await ctx.subtitles.scan(file.id)
    const first = ctx.subtitles.files()[0]!.inventory[0]!.generation
    writeFileSync(path, 'a different video')
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    await ctx.subtitles.scan(file.id)
    expect(
      ctx.subtitles.files()[0]!.inventory.find((r) => r.location === 'stream:2')!.generation,
    ).not.toBe(first)
  })

  it('reports a missing ffprobe as the reason, and scans once it is fixed', async () => {
    await boot(join(dir, 'missing-ffprobe'))
    const { file } = addMovie()
    await ctx.subtitles.scan(file.id)
    expect(ctx.subtitles.files()[0]!.probeError).toMatch(/ffprobe is not available/)

    await ctx.mediaTools.save({ ffprobe })
    for (let i = 0; i < 5; i++) await ctx.jobs.tick()
    const view = ctx.subtitles.files().find((v) => v.file.id === file.id)!
    expect(view.probeError).toBeNull()
    expect(view.inventory.some((r) => r.location === 'stream:2')).toBe(true)
  })

  it('reports tool health from the media tools settings', async () => {
    await boot()
    expect((await ctx.subtitles.toolHealth()).ffprobe).toBe('available')
    await ctx.mediaTools.save({ ffprobe: join(dir, 'nope') })
    expect((await ctx.subtitles.toolHealth()).ffprobe).toBe('not found')
  })
})

describe('ffprobe path saved by earlier versions', () => {
  it('moves to media tools on first start', async () => {
    ctx = await createTestContext({ metadata: false, calendar: false, db: join(dir, 'magpie.db') })
    await ctx.plugin(MediaTools)
    await ctx.plugin(MediaInfo)
    await ctx.plugin(Subtitles)
    // what the previous version kept in its own settings
    ctx.subtitles.db
      .insert((await import('../src/schema')).settings)
      .values({
        key: 'tools',
        value: { ffprobe: ffprobe, syncEngine: 'ffsubsync', syncBinary: '' },
      })
      .run()
    const restarted = await createTestContext({
      metadata: false,
      calendar: false,
      db: join(dir, 'magpie.db'),
    })
    await restarted.plugin(MediaTools)
    await restarted.plugin(MediaInfo)
    await restarted.plugin(Subtitles)
    await new Promise((r) => setTimeout(r, 50))
    expect(restarted.mediaTools.path('ffprobe')).toBe(ffprobe)
  })
})
