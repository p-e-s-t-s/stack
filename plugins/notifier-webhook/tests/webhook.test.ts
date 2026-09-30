import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import Notifications from '@magpiejs/notifications'
import { createTestContext } from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Webhook from '../src'
import { request } from '../src'

let server: Server
let received: { headers: Record<string, unknown>; body: string }[]
let status: number
let ctx: Context

beforeEach(async () => {
  received = []
  status = 200
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      res.statusCode = status
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(Notifications)
})

afterEach(() => new Promise((resolve) => server.close(resolve)))

const url = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`
const config = (extra = {}) => Webhook.Config({ url: url(), ...extra } as never)

describe('webhook request', () => {
  it('signs the timestamp and exact body when there is a secret', () => {
    const { body, headers } = request(
      { type: 'media.imported', title: 'T' },
      { token: 't0k', signingSecret: 's3cret' },
      5_000_000,
      'id-1',
    )
    const expected = createHmac('sha256', 's3cret').update(`5000.${body}`).digest('hex')
    expect(headers['X-Magpie-Signature']).toBe(`sha256=${expected}`)
    expect(headers['X-Magpie-Timestamp']).toBe('5000')
    expect(headers['X-Magpie-Delivery']).toBe('id-1')
    expect(headers.Authorization).toBe('Bearer t0k')
    expect(JSON.parse(body)).toMatchObject({ version: 1, id: 'id-1', type: 'media.imported' })
  })

  it('sends no auth headers without a token or secret', () => {
    const { headers } = request({ type: 'x', title: 'T' }, { token: '', signingSecret: '' })
    expect(Object.keys(headers).sort()).toEqual(['X-Magpie-Delivery', 'X-Magpie-Event'])
  })
})

describe('webhook destination', () => {
  it('delivers an import to the URL', async () => {
    await ctx.plugin(Webhook, config({ name: 'Hook' }))
    ctx.emit('media/changed', {
      origin: 'download',
      item: { id: 1, kind: 'movie', title: 'Movie', year: 2000 } as never,
      added: ['/m/movie.mkv'],
      removed: [],
      replaced: false,
    })
    await ctx.jobs.tick()
    expect(received).toHaveLength(1)
    expect(received[0]!.headers['x-magpie-event']).toBe('media.imported')
    expect(JSON.parse(received[0]!.body)).toMatchObject({ title: 'Imported: Movie (2000)' })
  })

  it('tests the connection and reports a rejection', async () => {
    await ctx.plugin(Webhook, config({ name: 'Hook' }))
    const [destination] = ctx.notifications.destinations()
    expect(await ctx.notifications.test(destination!.id)).toMatchObject({ ok: true })
    status = 401
    expect(await ctx.notifications.test(destination!.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining('refused'),
    })
  })
})
