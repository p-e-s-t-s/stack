import DatabaseService from '@magpiejs/database'
import type { ReleaseInfo } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, expect, it } from 'vitest'
import DecisionService, { type BaseParsed, profileItems, type QualityFamily } from '../src'

const AUDIO = ['mp3-192', 'mp3-320', 'flac']

// a tiny audio family: `Artist - Album [FLAC]`
const audio: QualityFamily<BaseParsed & { format?: string }> = {
  id: 'audio',
  label: 'Audio',
  qualities: AUDIO.map((id) => ({ id, name: id.toUpperCase() })),
  parse: (title) => {
    const format = /\[(FLAC|MP3-320|MP3-192)\]/i.exec(title)?.[1]?.toLowerCase()
    return {
      input: title,
      title: title.split(' [')[0]!,
      kind: 'album',
      revision: { version: 1, real: 0, proper: false, repack: false },
      languages: ['en'],
      flags: [],
      format,
    }
  },
  qualityOf: (p) => p.format ?? 'unknown-audio',
  sizeRule: 'total',
  defaultSizes: { flac: 100 },
  defaultProfiles: [{ name: 'Lossless', items: profileItems(AUDIO, ['flac']), cutoff: 'flac' }],
  conditions: { format: { label: 'Format', test: (p, v) => p.format === v } },
}

let ctx: Context
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(DecisionService)
})

const release = (title: string, size = 300 * 1024 ** 2): ReleaseInfo => ({
  guid: title,
  title,
  protocol: 'torrent',
  indexerId: 'x',
  downloadUrl: '',
  size,
  seeders: 10,
})

it('judges releases with a registered family', async () => {
  const withFamily = (family: QualityFamily<any>) => ({
    inject: ['decision'],
    apply: (ctx: Context) => void ctx.decision.family(family),
  })
  const fiber = await ctx.plugin(withFamily(audio))
  const lossless = ctx.decision.profiles('audio')
  expect(lossless.map((p) => [p.name, p.family, p.cutoff])).toEqual([['Lossless', 'audio', 'flac']])
  expect(ctx.decision.profiles('video').map((p) => p.name)).toEqual(['Any', 'HD', 'Ultra HD'])
  expect(ctx.decision.qualityName('flac')).toBe('FLAC')

  // formats with another family's conditions don't apply; the family's own do
  const x265 = ctx.decision.saveFormat({
    name: 'Not x265',
    conditions: [{ type: 'videoCodec', value: 'x265', negate: true }],
    includeInFileName: false,
  })
  const flac = ctx.decision.saveFormat({
    name: 'FLAC',
    conditions: [{ type: 'format', value: 'flac' }],
    includeInFileName: false,
  })
  ctx.decision.setScore(lossless[0]!.id, x265, 50)
  ctx.decision.setScore(lossless[0]!.id, flac, 10)

  const evaluate = ctx.decision.evaluator({ kind: 'album', profileId: lossless[0]!.id })
  const good = evaluate({ info: release('Artist - Album [FLAC]') })
  expect(good).toMatchObject({ accepted: true, quality: 'flac', matchedFormats: ['FLAC'] })
  const lossy = evaluate({ info: release('Artist - Album [MP3-320]') })
  expect(lossy.rejections.map((r) => r.rule)).toEqual(['quality-allowed'])
  // sizes are in MB per release for this family
  const tiny = evaluate({ info: release('Artist - Album [FLAC]', 20 * 1024 ** 2) })
  expect(tiny.rejections.map((r) => r.reason)).toEqual([
    'too small for FLAC (20.0 MB, minimum 100)',
  ])

  // quality ids are unique across families
  await expect(ctx.plugin(withFamily({ ...audio, id: 'audio2' }))).rejects.toThrow(
    /already belongs/,
  )

  await fiber.dispose()
  expect(ctx.decision.families().map((f) => f.id)).toEqual(['video'])
})
