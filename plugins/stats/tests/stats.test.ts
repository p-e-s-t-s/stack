import { createTestContext } from '@magpiejs/testing'
import HistoryService from '@magpiejs/history'
import { expect, it } from 'vitest'
import StatsService, { isoDay } from '../src'

it('counts titles, files, bytes, quality and recent activity', async () => {
  const ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(HistoryService)
  await ctx.plugin(StatsService)
  const profileId = ctx.decision.profiles()[0]!.id
  const rootFolderId = ctx.library.addRootFolder('/movies', 'movie').id
  const add = (title: string, monitored: boolean) =>
    ctx.library.add({
      kind: 'movie',
      title,
      year: 2020,
      externalIds: {},
      primaryProvider: 'test',
      profileId,
      rootFolderId,
      folder: title,
      monitored,
    })
  const a = add('A', true)
  add('B', false)
  const file = (mediaId: number, size: number) =>
    ctx.library.addFile({
      mediaId,
      path: `${size}.mkv`,
      size,
      quality: 'unknown',
      formatScore: 0,
      languages: [],
      releaseName: null,
      releaseGroup: null,
      revision: { version: 1, real: 0 } as never,
    })
  file(a.id, 1000)
  file(a.id, 500)
  ctx.history.add(a.id, 'grabbed', 'A.2020', {})
  ctx.history.add(a.id, 'imported', 'A.2020', {})
  ctx.history.add(a.id, 'download-failed', 'A.2020', {})

  const s = ctx.stats.snapshot(7)
  const movies = s.kinds.find((k) => k.kind === 'movie')!
  expect(movies).toMatchObject({ items: 2, monitored: 1, withFiles: 1, files: 2, bytes: 1500 })
  expect(s.totals).toEqual({ items: 2, files: 2, bytes: 1500 })
  expect(s.qualities).toHaveLength(1)
  expect(s.qualities[0]).toMatchObject({ files: 2, bytes: 1500 })
  expect(s.days).toHaveLength(7)
  expect(s.days.at(-1)).toEqual({ day: isoDay(Date.now()), grabbed: 1, imported: 1, failed: 1 })
})
