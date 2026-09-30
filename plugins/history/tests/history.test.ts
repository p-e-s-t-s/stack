import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { beforeEach, expect, it } from 'vitest'
import HistoryService from '../src'

let ctx: Context
let a: number
let b: number
const add = (title: string) =>
  ctx.library.add({
    kind: 'movie',
    title,
    externalIds: {},
    primaryProvider: 'none',
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: (
      ctx.library.rootFolders('movie')[0] ?? ctx.library.addRootFolder('/lib', 'movie')
    ).id,
    folder: title,
  }).id

beforeEach(async () => {
  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(HistoryService)
  a = add('A')
  b = add('B')
})

it('records events and lists them newest first, per item or overall', () => {
  ctx.history.add(a, 'grabbed', 'A.1080p', { quality: 'x' })
  ctx.history.add(b, 'imported', 'B.1080p', {})
  ctx.history.add(a, 'download-failed', 'A.1080p', { reason: 'no seeds' })

  expect(ctx.history.list().map((e) => [e.mediaId, e.type])).toEqual([
    [a, 'download-failed'],
    [b, 'imported'],
    [a, 'grabbed'],
  ])
  expect(ctx.history.list({ mediaId: a }).map((e) => e.type)).toEqual([
    'download-failed',
    'grabbed',
  ])
  expect(ctx.history.list({ limit: 1 })).toHaveLength(1)
  expect(ctx.history.list({ mediaId: a })[1]!.data).toEqual({ quality: 'x' })
})

it('announces each event, and ignores items that are not in the library', () => {
  const seen: string[] = []
  ctx.on('history/added', (e) => void seen.push(e.title))
  expect(ctx.history.add(9999, 'grabbed', 'ghost', {})).toBeUndefined()
  expect(ctx.history.add(a, 'grabbed', 'real', {})).toMatchObject({ mediaId: a, title: 'real' })
  expect(seen).toEqual(['real'])
})

it('turns download and import events into history', () => {
  const grab = {
    mediaId: a,
    title: 'A.1080p',
    quality: 'unknown',
    manual: true,
    error: 'disk full',
    release: { indexerId: 'idx' },
  }
  ;(ctx as any).emit('downloads/grabbed', grab)
  ;(ctx as any).emit('downloads/failed', grab)
  ;(ctx as any).emit('import/completed', { id: a }, grab, { files: 2 })
  ;(ctx as any).emit('import/failed', { id: a }, grab, 'no video')
  const events = ctx.history.list({ mediaId: a }).reverse()
  expect(events.map((e) => e.type)).toEqual([
    'grabbed',
    'download-failed',
    'imported',
    'import-failed',
  ])
  expect(events[0]!.data).toMatchObject({ indexer: 'idx', manual: true })
  expect(events[1]!.data).toEqual({ reason: 'disk full' })
  expect(events[2]!.data).toMatchObject({ files: 2 })
  expect(events[3]!.data).toEqual({ reason: 'no video' })
})

it("drops an item's history when it leaves the library", () => {
  ctx.history.add(a, 'grabbed', 'A', {})
  ctx.history.add(b, 'grabbed', 'B', {})
  ctx.library.remove(a)
  expect(ctx.history.list().map((e) => e.mediaId)).toEqual([b])
})
