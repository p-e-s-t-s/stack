// @magpiejs/notifier-ntfy: publishes each event to an ntfy topic (ntfy.sh or self-hosted).
// Docs: https://docs.ntfy.sh/publish/

import type {} from '@cordisjs/plugin-http'
import { eventConfig, type EventConfig, eventsOf } from '@magpiejs/notifications/config'
import { checkUrl, post } from '@magpiejs/notifications/transport'
import type { NotificationEvent } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'notifier-ntfy'
export const inject = ['http', 'notifications']

export interface Config extends EventConfig {
  name: string
  server: string
  topic: string
  token: string
  priority: number
}

export const Config: z<Config> = z.object({
  name: z.string().default('ntfy').description('Name shown in Magpie.'),
  server: z.string().default('https://ntfy.sh').description('ntfy server address.'),
  topic: z
    .string()
    .role('secret')
    .default('')
    .description('Topic to publish to. Anyone who knows it can read the messages.'),
  token: z.string().role('secret').default('').description('Optional access token.'),
  priority: z.natural().min(1).max(5).default(3).description('1 (min) to 5 (max); 3 is default.'),
  ...eventConfig,
})

const TAGS: Record<string, string[]> = {
  'media.imported': ['inbox_tray'],
  'media.upgraded': ['arrow_up'],
  'import.failed': ['warning'],
  'download.failed': ['warning'],
  'download.grabbed': ['mag'],
  test: ['white_check_mark'],
}

/** The JSON publish body (works for any characters in titles, unlike headers). */
export function payload(event: NotificationEvent, config: Pick<Config, 'topic' | 'priority'>) {
  const failed = event.type.endsWith('.failed')
  return {
    topic: config.topic,
    title: event.title,
    message: event.body ?? event.title,
    priority: failed ? Math.max(config.priority, 4) : config.priority,
    tags: TAGS[event.type] ?? [],
  }
}

export function apply(ctx: Context, config: Config) {
  const url = checkUrl(config.server)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.topic))
    throw new Error('the topic may only have letters, digits, - and _')
  const id = `ntfy:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  const send = async (event: NotificationEvent, signal?: AbortSignal) => {
    await post(ctx, url.toString(), {
      body: JSON.stringify(payload(event, config)),
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
      signal,
    })
  }
  ctx.notifications.register(
    {
      id,
      events: eventsOf(config),
      send: (event, options) => send(event, options?.signal),
      async test() {
        try {
          await send({
            type: 'test',
            title: 'Test message from Magpie',
            body: 'If you can read this, ntfy notifications work.',
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
