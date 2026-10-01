import { createTestContext } from '@magpiejs/testing'
import { describe, expect, it } from 'vitest'
import HistoryService from '../src'

async function boot() {
  const ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(HistoryService)
  const add = (title: string) =>
    ctx.library.add({
      kind: 'movie',
      title,
      year: 2020,
      externalIds: {},
      primaryProvider: 'test',
      profileId: ctx.decision.profiles()[0]!.id,
      rootFolderId: (
        ctx.library.rootFolders('movie')[0] ?? ctx.library.addRootFolder('/movies', 'movie')
      ).id,
      folder: title,
    })
  return { ctx, add }
}

// Just the fields the history plugin reads from a grab.
const grab = (mediaId: number, over: Record<string, unknown> = {}) =>
  ({
    mediaId,
    title: 'Movie.2020.1080p',
    quality: 'unknown',
    release: { indexerId: 'idx' },
    manual: false,
    targetId: null,
    error: 'disk full',
    ...over,
  }) as never

describe('history', () => {
  it('records grabs, failures and imports from the download pipeline', async () => {
    const { ctx, add } = await boot()
    const item = add('Movie')
    ctx.emit('downloads/grabbed', grab(item.id, { manual: true }))
    ctx.emit('downloads/failed', grab(item.id))
    ctx.emit('import/completed', item, grab(item.id), {
      path: '/movies/Movie.mkv',
      method: 'hardlink',
    })
    ctx.emit('import/failed', item, grab(item.id), 'no video file')
    ctx.emit('import/rejected', item, grab(item.id), 'sample', { size: 1 })

    const events = ctx.history.list({ mediaId: item.id })
    expect(events.map((e) => e.type).sort()).toEqual(
      ['download-failed', 'grabbed', 'import-failed', 'import-rejected', 'imported'].sort(),
    )
    const byType = Object.fromEntries(events.map((e) => [e.type, e]))
    expect(byType.grabbed?.data).toMatchObject({ indexer: 'idx', manual: true, targetId: null })
    expect(byType['download-failed']?.data).toMatchObject({ reason: 'disk full' })
    expect(byType.imported?.data).toMatchObject({ path: '/movies/Movie.mkv', method: 'hardlink' })
    expect(byType['import-failed']?.data).toMatchObject({ reason: 'no video file' })
    expect(byType['import-rejected']?.data).toEqual({ reason: 'sample', detail: { size: 1 } })
    expect(events.every((e) => e.title === 'Movie.2020.1080p')).toBe(true)
  })

  it('ignores events for media that is not in the library', async () => {
    const { ctx } = await boot()
    ctx.emit('downloads/grabbed', grab(9999))
    expect(ctx.history.list()).toEqual([])
    expect(ctx.history.add(9999, 'grabbed', 't', {})).toBeUndefined()
  })

  it('announces each event and lists newest first, filtered by item, within a limit', async () => {
    const { ctx, add } = await boot()
    const a = add('A')
    const b = add('B')
    const announced: number[] = []
    ctx.on('history/added', (e) => void announced.push(e.id))
    const first = ctx.history.add(a.id, 'grabbed', 'one', {})!
    const second = ctx.history.add(b.id, 'grabbed', 'two', {})!
    const third = ctx.history.add(a.id, 'imported', 'three', {})!
    expect(announced).toEqual([first.id, second.id, third.id])
    expect(ctx.history.list().map((e) => e.title)).toEqual(['three', 'two', 'one'])
    expect(ctx.history.list({ mediaId: a.id }).map((e) => e.title)).toEqual(['three', 'one'])
    expect(ctx.history.list({ limit: 1 }).map((e) => e.title)).toEqual(['three'])
  })

  it('removes an item’s history when the item is removed', async () => {
    const { ctx, add } = await boot()
    const item = add('Gone')
    ctx.history.add(item.id, 'grabbed', 'x', {})
    ctx.library.remove(item.id)
    expect(ctx.history.list()).toEqual([])
  })
})
