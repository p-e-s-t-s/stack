import { createTestContext } from '@magpiejs/testing'
import type { NotificationEvent, Notifier } from '@magpiejs/types'
import type { Context } from 'cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import Notifications from '../src'

let ctx: Context
let clock: number

const item = { id: 1, kind: 'movie', title: 'Night of the Living Dead', year: 1968 } as never

function fake(id: string, events: string[], failures = 0) {
  const sent: { event: NotificationEvent; deliveryId?: string }[] = []
  let left = failures
  const notifier: Notifier = {
    id,
    events,
    async send(event, options) {
      if (left-- > 0) throw new Error('HTTP 503')
      sent.push({ event, deliveryId: options?.deliveryId })
    },
    async test() {
      return { ok: true }
    },
  }
  return { notifier, sent }
}

const imported = (replaced = false) =>
  ctx.emit('media/changed', {
    origin: 'download',
    item,
    added: ['/m/a.mkv'],
    removed: [],
    replaced,
    release: 'NOTLD.1968.1080p',
  })

beforeEach(async () => {
  clock = 1_000_000
  ctx = await createTestContext({ metadata: false, calendar: false })
  ctx.jobs.now = () => clock
  await ctx.plugin(Notifications)
  ctx.notifications.now = () => clock
})

describe('notifications', () => {
  it('sends an event only to destinations that want it', async () => {
    const all = fake('a', ['media.imported', 'import.failed'])
    const failuresOnly = fake('b', ['import.failed'])
    ctx.notifications.register(all.notifier, { name: 'A' })
    ctx.notifications.register(failuresOnly.notifier, { name: 'B' })
    imported()
    await ctx.jobs.tick()
    expect(all.sent.map((s) => s.event.type)).toEqual(['media.imported'])
    expect(all.sent[0]!.event.title).toBe('Imported: Night of the Living Dead (1968)')
    expect(failuresOnly.sent).toEqual([])
    expect(ctx.notifications.recent()).toMatchObject([{ notifierName: 'A', status: 'sent' }])
  })

  it('calls a replacement an upgrade', async () => {
    const a = fake('a', ['media.upgraded'])
    ctx.notifications.register(a.notifier, { name: 'A' })
    imported(true)
    await ctx.jobs.tick()
    expect(a.sent[0]!.event.type).toBe('media.upgraded')
  })

  it('never puts local paths in a message', async () => {
    const a = fake('a', ['media.imported'])
    ctx.notifications.register(a.notifier, { name: 'A' })
    imported()
    await ctx.jobs.tick()
    expect(JSON.stringify(a.sent[0]!.event)).not.toContain('/m/a.mkv')
  })

  it('retries a failed send with the same delivery id, then succeeds', async () => {
    const a = fake('a', ['media.imported'], 1)
    ctx.notifications.register(a.notifier, { name: 'A' })
    imported()
    await ctx.jobs.tick()
    expect(ctx.notifications.recent()[0]).toMatchObject({ status: 'retrying', error: 'HTTP 503' })
    clock += 60 * 60_000
    await ctx.jobs.tick()
    expect(ctx.notifications.recent()[0]).toMatchObject({
      status: 'sent',
      attempts: 2,
      error: null,
    })
    expect(a.sent[0]!.deliveryId).toBe(String(ctx.notifications.recent()[0]!.id))
  })

  it('gives up after the last attempt and says why, without the URL', async () => {
    const notifier: Notifier = {
      id: 'a',
      events: ['media.imported'],
      async send() {
        throw new Error('connect ECONNREFUSED https://hooks.example/secret-token')
      },
      async test() {
        return { ok: true }
      },
    }
    ctx.notifications.register(notifier, { name: 'A' })
    imported()
    for (let i = 0; i < 5; i++) {
      await ctx.jobs.tick()
      clock += 60 * 60_000
    }
    const [row] = ctx.notifications.recent()
    expect(row).toMatchObject({ status: 'failed', attempts: 5 })
    expect(row!.error).toBe('connect ECONNREFUSED <url>')
  })

  it('cancels queued messages when the destination goes away', async () => {
    const a = fake('a', ['media.imported'])
    const dispose = ctx.notifications.register(a.notifier, { name: 'A' })
    imported()
    dispose()
    await ctx.jobs.tick()
    expect(a.sent).toEqual([])
    expect(ctx.notifications.recent()[0]).toMatchObject({ status: 'cancelled' })
  })

  it('reports failed downloads and imports', async () => {
    const a = fake('a', ['download.failed', 'import.failed'])
    ctx.notifications.register(a.notifier, { name: 'A' })
    ctx.emit(
      'import/failed',
      undefined,
      { id: 3, mediaId: 1, title: 'Some.Release' } as never,
      'no video file',
    )
    ctx.emit('downloads/failed', {
      id: 3,
      mediaId: 1,
      title: 'Some.Release',
      error: 'stalled',
    } as never)
    await ctx.jobs.tick()
    expect(a.sent.map((s) => [s.event.type, s.event.body])).toEqual([
      ['import.failed', 'no video file'],
      ['download.failed', 'stalled'],
    ])
  })

  it('logs a test message and prunes old entries', async () => {
    const a = fake('a', [])
    ctx.notifications.register(a.notifier, { name: 'A' })
    expect(await ctx.notifications.test('a')).toEqual({ ok: true })
    expect(await ctx.notifications.test('missing')).toMatchObject({ ok: false })
    expect(ctx.notifications.recent()).toMatchObject([{ event: 'test', status: 'sent' }])
    clock += 31 * 24 * 60 * 60_000
    ctx.notifications.prune()
    expect(ctx.notifications.recent()).toEqual([])
  })
})
