// @magpiejs/notifier-webhook: POSTs each event as JSON to a URL you choose.
//
// Request: `Content-Type: application/json`, body `{ version: 1, id, type, title, body?,
// data?, sentAt }`. `X-Magpie-Event` and `X-Magpie-Delivery` repeat `type` and `id`; a receiver
// can drop repeats by delivery id (retries of one message reuse it; a crash can still send
// one twice). With a signing secret,
// `X-Magpie-Timestamp` (unix seconds) and `X-Magpie-Signature: sha256=<hex>` are sent, where
// the signature is HMAC-SHA256 over `<timestamp>.<exact body>`. Receivers should reject old
// timestamps.

import type {} from '@cordisjs/plugin-http'
import { eventConfig, type EventConfig, eventsOf } from '@magpiejs/notifications/config'
import { checkUrl, post } from '@magpiejs/notifications/transport'
import type { NotificationEvent } from '@magpiejs/types'
import type { Context } from 'cordis'
import { createHmac, randomUUID } from 'node:crypto'
import z from 'schemastery'

export const name = 'notifier-webhook'
export const inject = ['http', 'notifications']

export interface Config extends EventConfig {
  name: string
  url: string
  token: string
  signingSecret: string
}

export const Config: z<Config> = z.object({
  name: z.string().default('Webhook').description('Name shown in Magpie.'),
  url: z.string().role('secret').default('').description('Where to send events (HTTP POST).'),
  token: z.string().role('secret').default('').description('Optional bearer token.'),
  signingSecret: z
    .string()
    .role('secret')
    .default('')
    .description('Optional secret used to sign each request.'),
  ...eventConfig,
})

/** The body and headers for one delivery. Exported for tests and for documenting the format. */
export function request(
  event: NotificationEvent,
  config: Pick<Config, 'token' | 'signingSecret'>,
  now = Date.now(),
  id: string = randomUUID(),
) {
  const body = JSON.stringify({
    version: 1,
    id,
    type: event.type,
    title: event.title,
    body: event.body,
    data: event.data,
    sentAt: new Date(now).toISOString(),
  })
  const headers: Record<string, string> = {
    'X-Magpie-Event': event.type,
    'X-Magpie-Delivery': id,
  }
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  if (config.signingSecret) {
    const timestamp = String(Math.floor(now / 1000))
    headers['X-Magpie-Timestamp'] = timestamp
    headers['X-Magpie-Signature'] =
      `sha256=${createHmac('sha256', config.signingSecret).update(`${timestamp}.${body}`).digest('hex')}`
  }
  return { body, headers }
}

export function apply(ctx: Context, config: Config) {
  checkUrl(config.url)
  const id = `webhook:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  const send = async (event: NotificationEvent, signal?: AbortSignal, deliveryId?: string) => {
    await post(ctx, config.url, { ...request(event, config, Date.now(), deliveryId), signal })
  }
  ctx.notifications.register(
    {
      id,
      events: eventsOf(config),
      send: (event, options) => send(event, options?.signal, options?.deliveryId),
      async test() {
        try {
          await send({
            type: 'test',
            title: 'Test message from Magpie',
            body: 'If you can read this, the webhook works.',
          })
          return { ok: true, message: 'Sent' }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    { name: config.name },
  )
}
