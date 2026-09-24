import DatabaseService from '@magpiejs/database'
import { parse } from '@magpiejs/parser'
import type { ReleaseInfo } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import DecisionService, { type DecisionTarget, qualityOf } from '../src'

let ctx: Context
let hd: number
let uhd: number

const GB = 1024 ** 3
const release = (title: string, extra: Partial<ReleaseInfo> = {}): { info: ReleaseInfo } => ({
  info: {
    guid: title,
    title,
    protocol: 'torrent',
    indexerId: 'x',
    downloadUrl: '',
    seeders: 10,
    size: 8 * GB,
    ...extra,
  },
})

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(DecisionService)
  const profiles = ctx.decision.profiles()
  hd = profiles.find((p) => p.name === 'HD')!.id
  uhd = profiles.find((p) => p.name === 'Ultra HD')!.id
})

const movie = (profileId: number, extra: Partial<DecisionTarget> = {}): DecisionTarget => ({
  kind: 'movie',
  profileId,
  runtimeMinutes: 120,
  ...extra,
})

describe('decision', () => {
  it('seeds the three default profiles', () => {
    expect(ctx.decision.profiles().map((p) => p.name)).toEqual(['Any', 'HD', 'Ultra HD'])
  })

  it('maps parsed releases to qualities', () => {
    const q = (name: string) => qualityOf(parse(name))
    expect(q('M.2020.2160p.UHD.BluRay.REMUX.HEVC-G')).toBe('remux-2160p')
    expect(q('M.2020.1080p.AMZN.WEB-DL.H264-G')).toBe('webdl-1080p')
    expect(q('S.S01E01.720p.HDTV.x264-G')).toBe('hdtv-720p')
    expect(q('M.2020.CAM.x264-G')).toBe('cam')
    expect(q('M.2020.COMPLETE.BLURAY-G')).toBe('brdisk')
  })

  it('accepts a good release and rejects with readable reasons', () => {
    const ok = ctx.decision.evaluate(release('Movie.2020.1080p.BluRay.x264-GROUP'), movie(hd))
    expect(ok).toMatchObject({ accepted: true, quality: 'bluray-1080p' })

    const bad = ctx.decision.evaluate(
      release('Movie.2020.GERMAN.2160p.WEB-DL.H265-GROUP', { seeders: 0, size: 0.5 * GB }),
      movie(hd),
    )
    expect(bad.accepted).toBe(false)
    expect(bad.rejections.map((r) => r.rule).sort()).toEqual([
      'language',
      'quality-allowed',
      'seeders',
      'size',
    ])
  })

  it('checks size against the runtime', () => {
    const tiny = ctx.decision.evaluate(
      release('Movie.2020.1080p.BluRay.x264-G', { size: 0.2 * GB }),
      movie(hd),
    )
    expect(tiny.rejections.map((r) => r.rule)).toEqual(['size'])
  })

  it('scores custom formats and enforces the minimum score', () => {
    const format = ctx.decision.saveFormat({
      name: 'Dolby Vision',
      conditions: [{ type: 'hdr', value: 'dv', required: true }],
      includeInFileName: false,
    })
    const avoid = ctx.decision.saveFormat({
      name: 'No x265 below 2160p',
      conditions: [
        { type: 'videoCodec', value: 'x265', required: true },
        { type: 'resolution', value: '2160p', required: true, negate: true },
      ],
      includeInFileName: false,
    })
    ctx.decision.setScore(uhd, format, 100)
    ctx.decision.setScore(hd, avoid, -1000)
    ctx.decision.saveProfile({ ...ctx.decision.profile(hd)!, minFormatScore: 0 })

    const dv = ctx.decision.evaluate(
      release('Movie.2020.2160p.WEB-DL.DV.HDR.H.265-G', { size: 20 * GB }),
      movie(uhd),
    )
    expect(dv).toMatchObject({ accepted: true, formatScore: 100, matchedFormats: ['Dolby Vision'] })

    const x265 = ctx.decision.evaluate(release('Movie.2020.1080p.BluRay.x265-G'), movie(hd))
    expect(x265.formatScore).toBe(-1000)
    expect(x265.rejections.map((r) => r.rule)).toEqual(['min-format-score'])
  })

  it('applies required and ignored terms', () => {
    ctx.decision.saveRestriction({ required: [], ignored: ['/\\bHC\\b/'] })
    const d = ctx.decision.evaluate(release('Movie.2020.HC.1080p.WEBRip.x264-G'), movie(hd))
    expect(d.rejections.map((r) => r.rule)).toContain('restrictions')
  })

  it('matches episodes and season packs', () => {
    const target: DecisionTarget = {
      kind: 'episode',
      profileId: hd,
      episodes: { season: 2, numbers: [5] },
    }
    const rule = (title: string) =>
      ctx.decision
        .evaluate(release(title), target)
        .rejections.filter((r) => r.rule === 'episode-match')
    expect(rule('Show.S02E05.1080p.WEB.H264-G')).toEqual([])
    expect(rule('Show.S02E06.1080p.WEB.H264-G')).toHaveLength(1)
    expect(rule('Show.S03E05.1080p.WEB.H264-G')).toHaveLength(1)
    expect(rule('Show.S02.1080p.WEB.H264-G')).toHaveLength(1)
    expect(
      ctx.decision.evaluate(release('Show.S02E05.1080p.WEB.H264-G'), movie(hd)).rejections[0]?.rule,
    ).toBe('episode-match')
  })

  it('only accepts upgrades until the cutoff is met', () => {
    const revision = { version: 1, real: 0, proper: false, repack: false }
    const withFile = (
      quality: DecisionTarget['current'] extends infer C
        ? C extends { quality: infer Q }
          ? Q
          : never
        : never,
    ) => movie(hd, { current: { quality, formatScore: 0, revision } })

    const upgrade = ctx.decision.evaluate(
      release('Movie.2020.1080p.BluRay.x264-G'),
      withFile('webdl-1080p'),
    )
    expect(upgrade.accepted).toBe(true)

    const same = ctx.decision.evaluate(
      release('Movie.2020.1080p.WEBRip.x264-G'),
      withFile('webdl-1080p'),
    )
    expect(same.rejections.map((r) => r.reason)).toEqual(['not an upgrade over the existing file'])

    const proper = ctx.decision.evaluate(
      release('Movie.2020.PROPER.1080p.WEB-DL.x264-G'),
      withFile('webdl-1080p'),
    )
    expect(proper.accepted).toBe(true)

    const cutoff = ctx.decision.evaluate(
      release('Movie.2020.PROPER.1080p.BluRay.x264-G'),
      withFile('bluray-1080p'),
    )
    expect(cutoff.rejections.map((r) => r.reason)).toEqual([
      'existing file already meets the cutoff',
    ])
  })

  it('ranks accepted releases best first', () => {
    const ranked = ctx.decision.evaluateAll(
      [
        release('Movie.2020.720p.WEB-DL.x264-G', { size: 4 * GB }),
        release('Movie.2020.1080p.BluRay.x264-G', { seeders: 5 }),
        release('Movie.2020.1080p.BluRay.x264-H', { seeders: 50 }),
        release('Movie.2020.1080p.WEB-DL.x264-G'),
      ],
      movie(hd),
    )
    expect(ranked.map((d) => d.parsed.input)).toEqual([
      'Movie.2020.1080p.BluRay.x264-H',
      'Movie.2020.1080p.BluRay.x264-G',
      'Movie.2020.1080p.WEB-DL.x264-G',
      'Movie.2020.720p.WEB-DL.x264-G',
    ])
  })

  it('lets other plugins add rules for their lifetime', async () => {
    const fiber = await ctx.plugin({
      inject: ['decision'],
      apply: (ctx: Context) =>
        ctx.decision.rule('blocklist', ({ info }) =>
          info.title.includes('-BAD') ? 'blocklisted' : undefined,
        ),
    })
    const title = 'Movie.2020.1080p.BluRay.x264-BAD'
    expect(ctx.decision.evaluate(release(title), movie(hd)).rejections.map((r) => r.rule)).toEqual([
      'blocklist',
    ])
    await fiber.dispose()
    expect(ctx.decision.evaluate(release(title), movie(hd)).accepted).toBe(true)
  })
})
