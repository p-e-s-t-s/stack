import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MediaInfo from '@magpiejs/mediainfo'
import MediaTools from '@magpiejs/media-tools'
import { createTestContext } from '@magpiejs/testing'
import {
  SubtitleProviderError,
  type SubtitleCandidate,
  type SubtitleProvider,
  type SubtitleRequirement,
} from '@magpiejs/types'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Subtitles from '../src'

const srt = (text: string) =>
  `1\n00:00:01,000 --> 00:00:03,000\n${text}\n\n2\n00:00:04,000 --> 00:00:06,000\nBye\n`
const FACTS = {
  format: { format_name: 'matroska,webm', duration: '5400' },
  streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
}
const GERMAN: SubtitleRequirement = {
  id: 'de',
  language: 'de',
  forced: 'either',
  hi: 'either',
  embedded: false,
  formats: ['srt'],
  minimum: 0,
  cutoff: 80,
}

let dir: string
let ctx: Context
let fileId: number
let movieDir: string
let calls: { search: number; download: number }
let results: SubtitleCandidate[]
let downloads: Record<string, string>
let actions: [string, Record<string, unknown>][]
let removeProvider: () => void

const candidate = (over: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({
  id: 'c1',
  providerId: 'ignored',
  fileId: 'f1',
  name: 'Movie.de.srt',
  language: 'de',
  forced: false,
  hi: false,
  format: 'srt',
  ids: { imdb: 'tt1' },
  ...over,
})

function fakeProvider(over: Partial<SubtitleProvider> = {}): SubtitleProvider {
  return {
    id: 'fake',
    name: 'Fake',
    priority: 1,
    automatic: true,
    async search() {
      calls.search++
      return results
    },
    async download(c) {
      calls.download++
      return new TextEncoder().encode(downloads[c.id] ?? srt('Hallo'))
    },
    async test() {
      return 'ok'
    },
    ...over,
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-acquire-'))
  const ffprobe = join(dir, 'ffprobe')
  writeFileSync(join(dir, 'facts.json'), JSON.stringify(FACTS))
  writeFileSync(
    ffprobe,
    `#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffprobe version 7.1 Copyright"; exit 0; fi\ncat '${join(dir, 'facts.json')}'\n`,
  )
  chmodSync(ffprobe, 0o755)

  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(MediaTools)
  await ctx.mediaTools.save({ ffprobe })
  await ctx.plugin(MediaInfo)
  await ctx.plugin(Subtitles)

  const item = ctx.library.add({
    kind: 'movie',
    title: 'Movie',
    year: 2020,
    externalIds: { imdb: 'tt1' },
    primaryProvider: 'none',
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: ctx.library.addRootFolder(join(dir, 'lib'), 'movie').id,
    folder: 'movie',
  })
  movieDir = join(dir, 'lib', 'movie')
  mkdirSync(movieDir, { recursive: true })
  writeFileSync(join(movieDir, 'movie.mkv'), 'video')
  fileId = ctx.library.addFile({
    mediaId: item.id,
    path: 'movie.mkv',
    size: 5,
    quality: 'bluray-1080p',
    formatScore: 0,
    languages: ['en'],
    releaseName: null,
    releaseGroup: null,
    revision: { version: 1, real: 0, proper: false, repack: false },
  }).id

  const profile = ctx.subtitles.saveProfile({ name: 'German', requirements: [GERMAN] })
  ctx.subtitles.assign(item.id, profile.id)

  calls = { search: 0, download: 0 }
  results = [candidate()]
  downloads = {}
  actions = []
  ctx.on('subtitles/action', (_id, type, detail) => void actions.push([type, detail]))
  removeProvider = ctx.subtitles.register(fakeProvider())
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const inventory = () => ctx.subtitles.files()[0]!.inventory
const find = (location: string) => inventory().find((r) => r.location === location)
const first = async () => (await ctx.subtitles.search(fileId, 'de')).rows[0]!

describe('searching', () => {
  it('ranks verified candidates first and explains why others are rejected', async () => {
    results = [
      candidate({ id: 'unknown', ids: {} }),
      candidate({ id: 'good' }),
      candidate({ id: 'wrong', ids: { imdb: 'tt9' } }),
      candidate({ id: 'dupe' }),
      candidate({ id: 'dupe' }),
    ]
    const { rows, errors } = await ctx.subtitles.search(fileId, 'de')
    expect(errors).toEqual([])
    expect(rows.map((r) => r.score)).toEqual([60, 60, 0, 0]) // the duplicate id collapses
    expect(rows.find((r) => r.name === 'Movie.de.srt' && r.score === 60)?.reasons).toEqual([])
    expect(rows.flatMap((r) => r.reasons)).toEqual(
      expect.arrayContaining([
        'identity unverified; manual selection only',
        'imdb identity conflict',
      ]),
    )
  })

  it('reports a failing provider without failing the search, then pauses it', async () => {
    ctx.subtitles.register(
      fakeProvider({
        id: 'bad',
        name: 'Bad',
        priority: 2,
        search: async () => Promise.reject(new SubtitleProviderError('rate-limit', 'slow down')),
      }),
    )
    const { rows, errors } = await ctx.subtitles.search(fileId, 'de')
    expect(rows).toHaveLength(1)
    expect(errors).toEqual([{ provider: 'Bad', message: 'slow down' }])
    expect(ctx.subtitles.health().find((h) => h.id === 'bad')).toMatchObject({
      code: 'rate-limit',
      error: 'slow down',
    })
    // a second search does not call the paused provider again
    const again = await ctx.subtitles.search(fileId, 'de')
    expect(again.errors[0]?.message).toBe('slow down')
  })

  it('refuses a requirement that is not in the file’s profile', async () => {
    await expect(ctx.subtitles.search(fileId, 'nope')).rejects.toThrow('assign a subtitle profile')
  })
})

describe('acquiring', () => {
  it('installs the subtitle next to the video, records it, and announces it', async () => {
    const row = await first()
    const op = await ctx.subtitles.acquire(row.token)
    expect(readFileSync(join(movieDir, 'movie.de.srt'), 'utf8')).toBe(srt('Hallo'))
    expect(find('movie.de.srt')).toMatchObject({
      managed: true,
      protected: false,
      language: 'de',
      providerId: 'fake',
      score: 60,
      valid: true,
    })
    expect(ctx.subtitles.files()[0]!.wanted[0]).toMatchObject({
      requirementId: 'de',
      state: 'disabled',
      reason: 'automatic acquisition disabled',
    })
    expect(actions).toMatchObject([['subtitle-downloaded', { provider: 'Fake', score: 60 }]])
    expect(ctx.subtitles.operationList()).toMatchObject([{ id: op, state: 'done' }])
    // no staging or backup files are left behind
    expect(readdirSync(movieDir).filter((f) => f.startsWith('.magpie-'))).toEqual([])
  })

  it('names forced and hearing-impaired subtitles accordingly', async () => {
    results = [candidate({ forced: true, hi: true })]
    await ctx.subtitles.acquire((await first()).token)
    expect(existsSync(join(movieDir, 'movie.de.forced.hi.srt'))).toBe(true)
  })

  it('refuses a rejected candidate unless explicitly overridden', async () => {
    results = [candidate({ ids: {} })]
    const { token, reasons } = await first()
    expect(reasons.length).toBeGreaterThan(0)
    await expect(ctx.subtitles.acquire(token)).rejects.toThrow('explicitly confirm manual override')
    expect(calls.download).toBe(0)
    await ctx.subtitles.acquire(token, true)
    expect(existsSync(join(movieDir, 'movie.de.srt'))).toBe(true)
  })

  it.each([
    ['unreadable text', () => 'not a subtitle'],
    ['cues past the end of the film', () => '1\n02:00:00,000 --> 02:00:05,000\nx\n'],
  ])('does not install %s', async (_why, body) => {
    downloads.c1 = body()
    await expect(ctx.subtitles.acquire((await first()).token)).rejects.toThrow()
    expect(existsSync(join(movieDir, 'movie.de.srt'))).toBe(false)
    expect(ctx.subtitles.operationList()).toEqual([])
  })

  it('refuses when the video changed since the search', async () => {
    const { token } = await first()
    writeFileSync(join(movieDir, 'movie.mkv'), 'a different, longer video')
    await expect(ctx.subtitles.acquire(token)).rejects.toThrow('media or profile changed')
  })

  it('refuses when the profile changed since the search', async () => {
    const { token } = await first()
    const profile = ctx.subtitles.profiles()[0]!
    ctx.subtitles.saveProfile(
      { name: 'German', requirements: [{ ...GERMAN, cutoff: 90 }] },
      profile.id,
    )
    await expect(ctx.subtitles.acquire(token)).rejects.toThrow('media or profile changed')
  })

  it('refuses an expired search result', async () => {
    const { token } = await first()
    ctx.subtitles.now = () => Date.now() + 16 * 60_000
    await expect(ctx.subtitles.acquire(token)).rejects.toThrow('expired')
  })

  it('will not overwrite a subtitle the user put there', async () => {
    writeFileSync(join(movieDir, 'movie.de.srt'), srt('mine'))
    await expect(ctx.subtitles.acquire((await first()).token)).rejects.toThrow(
      'unmanaged, protected, or modified',
    )
    expect(readFileSync(join(movieDir, 'movie.de.srt'), 'utf8')).toBe(srt('mine'))
  })

  it('refuses when the provider has gone away', async () => {
    const { token } = await first()
    removeProvider()
    await expect(ctx.subtitles.acquire(token)).rejects.toThrow('provider is no longer enabled')
  })
})

describe('blocklist', () => {
  it('blocks a candidate for this file version, and allows it again once unblocked', async () => {
    const { token } = await first()
    ctx.subtitles.block(token)
    expect(() => ctx.subtitles.block(token)).toThrow('expired') // the ticket is spent
    const blocked = await first()
    expect(blocked.reasons).toContain('candidate blocklisted')
    await expect(ctx.subtitles.acquire(blocked.token, true)).rejects.toThrow(
      'unblock this candidate',
    )

    ctx.subtitles.unblock(ctx.subtitles.blocked()[0]!.id)
    expect((await first()).reasons).toEqual([])
  })
})

describe('replacing, undo and sync', () => {
  const install = async (body: string) => {
    downloads.c1 = body
    return ctx.subtitles.acquire((await first()).token, true) as Promise<string>
  }

  it('reports a replacement as an upgrade and can undo it from the backup', async () => {
    await install(srt('Version one'))
    const second = await install(srt('Version two'))
    expect(readFileSync(join(movieDir, 'movie.de.srt'), 'utf8')).toContain('Version two')
    expect(actions.map((a) => a[0])).toEqual(['subtitle-downloaded', 'subtitle-upgraded'])

    await ctx.subtitles.undo(second)
    expect(readFileSync(join(movieDir, 'movie.de.srt'), 'utf8')).toContain('Version one')
    // the restored file is protected so automation will not overwrite it again
    expect(inventory().find((r) => r.location.endsWith('movie.de.srt'))).toMatchObject({
      protected: true,
      score: null,
    })
  })

  it('will not undo once the subtitle has been edited', async () => {
    await install(srt('Version one'))
    const second = await install(srt('Version two'))
    writeFileSync(join(movieDir, 'movie.de.srt'), srt('edited by hand'))
    await expect(ctx.subtitles.undo(second)).rejects.toThrow('undo refused')
  })

  it('has nothing to undo for a first install', async () => {
    const first = await install(srt('Version one'))
    await expect(ctx.subtitles.undo(first)).rejects.toThrow('no replacement backup')
  })

  it('shifts a managed subtitle by an offset and records the sync', async () => {
    await install(srt('Hallo'))
    const row = inventory().find((r) => r.location.endsWith('movie.de.srt'))!
    await ctx.subtitles.sync(row.id, 2)
    expect(readFileSync(join(movieDir, 'movie.de.srt'), 'utf8')).toContain(
      '00:00:03,000 --> 00:00:05,000',
    )
    expect(actions.at(-1)).toMatchObject(['subtitle-synced', { offset: 2 }])
    expect(inventory().find((r) => r.id === row.id)).toMatchObject({ sync: 'succeeded' })
  })

  it('refuses to sync a subtitle Magpie does not manage, or with a bad offset', async () => {
    writeFileSync(join(movieDir, 'movie.en.srt'), srt('mine'))
    await ctx.subtitles.scan(fileId)
    const mine = inventory().find((r) => r.location.endsWith('movie.en.srt'))!
    await expect(ctx.subtitles.sync(mine.id, 1)).rejects.toThrow(
      'unprotected managed text subtitle',
    )
    await install(srt('Hallo'))
    const managed = inventory().find((r) => r.location.endsWith('movie.de.srt'))!
    await expect(ctx.subtitles.sync(managed.id, 9999)).rejects.toThrow('between -600 and 600')
    expect(inventory().find((r) => r.id === managed.id)).toMatchObject({ sync: 'failed' })
  })

  it('adopts a valid external subtitle as managed, and can protect it', async () => {
    writeFileSync(join(movieDir, 'movie.de.srt'), srt('mine'))
    await ctx.subtitles.scan(fileId)
    const row = inventory().find((r) => r.location.endsWith('movie.de.srt'))!
    expect(row.managed).toBe(false)
    await ctx.subtitles.adopt(row.id)
    expect(inventory().find((r) => r.id === row.id)).toMatchObject({
      managed: true,
      protected: false,
    })
    ctx.subtitles.protect(row.id, true)
    expect(inventory().find((r) => r.id === row.id)?.protected).toBe(true)
  })
})

describe('automatic acquisition', () => {
  const automatic = () => {
    const profile = ctx.subtitles.profiles()[0]!
    ctx.subtitles.saveProfile(
      { name: 'German', requirements: [GERMAN], policy: { ...profile.policy, automatic: true } },
      profile.id,
    )
  }

  it('downloads the best qualifying result for a missing subtitle', async () => {
    automatic()
    await ctx.subtitles.scan(fileId)
    await (
      ctx.subtitles as unknown as { automatic(f: number, r: string, s: AbortSignal): Promise<void> }
    ).automatic(fileId, 'de', new AbortController().signal)
    expect(existsSync(join(movieDir, 'movie.de.srt'))).toBe(true)
    expect(ctx.subtitles.files()[0]!.wanted[0]?.state).toBe('satisfied')
  })

  it('defers and backs off when there are no qualifying results', async () => {
    automatic()
    results = [candidate({ ids: {} })] // unverified results are manual-only
    await ctx.subtitles.scan(fileId)
    await (
      ctx.subtitles as unknown as { automatic(f: number, r: string, s: AbortSignal): Promise<void> }
    ).automatic(fileId, 'de', new AbortController().signal)
    expect(existsSync(join(movieDir, 'movie.de.srt'))).toBe(false)
    expect(ctx.subtitles.files()[0]!.wanted[0]).toMatchObject({
      state: 'waiting',
      reason: 'no qualifying results',
      attempts: 1,
    })
    expect(ctx.subtitles.files()[0]!.wanted[0]!.nextSearchAt).toBeGreaterThan(
      Date.now() + 5 * 3600_000,
    )
  })
})

describe('profiles', () => {
  it('will not delete a profile that is assigned or a default, until it is released', () => {
    const profile = ctx.subtitles.profiles()[0]!
    expect(() => ctx.subtitles.removeProfile(profile.id)).toThrow('reassign or disable')
    ctx.subtitles.assign(ctx.library.list()[0]!.id, 'inherit')
    ctx.subtitles.setDefault('movie', profile.id)
    expect(() => ctx.subtitles.removeProfile(profile.id)).toThrow('reassign or disable')
    ctx.subtitles.setDefault('movie', null)
    ctx.subtitles.removeProfile(profile.id)
    expect(ctx.subtitles.profiles()).toEqual([])
  })

  it('bumps a profile’s revision when it is edited, and rejects unknown profiles', () => {
    const profile = ctx.subtitles.profiles()[0]!
    expect(
      ctx.subtitles.saveProfile({ name: 'Renamed', requirements: [GERMAN] }, profile.id).revision,
    ).toBe(profile.revision + 1)
    expect(() => ctx.subtitles.saveProfile({ name: 'x', requirements: [GERMAN] }, 999)).toThrow(
      'profile not found',
    )
    expect(() => ctx.subtitles.assign(ctx.library.list()[0]!.id, 999)).toThrow(
      'invalid media item or profile',
    )
  })

  it('uses a kind default unless the item has its own assignment', () => {
    const item = ctx.library.list()[0]!
    const other = ctx.subtitles.saveProfile({ name: 'Other', requirements: [GERMAN] })
    ctx.subtitles.assign(item.id, 'inherit')
    expect(ctx.subtitles.effective(item)).toMatchObject({ profile: null, inherited: true })
    ctx.subtitles.setDefault('movie', other.id)
    expect(ctx.subtitles.effective(item)).toMatchObject({
      profile: { id: other.id },
      inherited: true,
    })
    ctx.subtitles.assign(item.id, null)
    expect(ctx.subtitles.effective(item)).toMatchObject({ profile: null, inherited: false })
  })
})

describe('providers', () => {
  it('rejects a second provider with the same id', () => {
    expect(() => ctx.subtitles.register(fakeProvider())).toThrow('already registered')
  })

  it('tests a provider, and reports one that is not running', async () => {
    expect(await ctx.subtitles.testProvider('fake')).toEqual({ ok: true, message: 'ok' })
    expect(await ctx.subtitles.testProvider('missing')).toEqual({
      ok: false,
      message: 'provider is not running',
    })
  })

  it('stops using a provider whose download quota is spent, until it resets', async () => {
    const reset = Date.now() + 3600_000
    ctx.subtitles.quota('fake', 0, reset)
    const spent = await ctx.subtitles.search(fileId, 'de')
    expect(spent.rows).toEqual([])
    expect(spent.errors).toEqual([
      { provider: 'Fake', message: 'provider download quota exhausted' },
    ])
    expect(calls.search).toBe(0)

    ctx.subtitles.now = () => reset + 1
    expect((await ctx.subtitles.search(fileId, 'de')).rows).toHaveLength(1)
  })
})
