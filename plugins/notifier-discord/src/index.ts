// @magpiejs/notifier-discord: posts each event as an embed to a Discord incoming webhook.
// Docs: https://docs.discord.com/developers/resources/webhook

import type {} from '@cordisjs/plugin-http'
import { eventConfig, type EventConfig, eventsOf } from '@magpiejs/notifications/config'
import { checkUrl, post } from '@magpiejs/notifications/transport'
import type { NotificationEvent } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'notifier-discord'
export const inject = ['http', 'notifications']

export interface Config extends EventConfig {
  name: string
  url: string
  threadId: string
  username: string
}

export const Config: z<Config> = z.object({
  name: z.string().default('Discord').description('Name shown in Magpie.'),
  url: z
    .string()
    .role('secret')
    .default('')
    .description("The channel's webhook URL (Channel settings → Integrations → Webhooks)."),
  threadId: z.string().default('').description('Optional: post into this thread of the channel.'),
  username: z.string().default('Magpie').description('Name Discord shows for the sender.'),
  ...eventConfig,
})

const COLORS: Record<string, number> = {
  'media.imported': 0x2ecc71,
  'media.upgraded': 0x3498db,
  'import.failed': 0xe74c3c,
  'download.failed': 0xe74c3c,
  'download.grabbed': 0x95a5a6,
  test: 0xf1c40f,
}

/** Stops release names and titles from turning into Discord formatting. */
export function escape(text: string) {
  return text.replace(/([\\*_~`|>[\]()#-])/g, '\\$1')
}

const cut = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text

/** The JSON body of one message: bounded embed text, and no mention can ping anyone. */
export function payload(event: NotificationEvent, username: string) {
  return {
    username: cut(username || 'Magpie', 80),
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: cut(escape(event.title), 256),
        ...(event.body && { description: cut(escape(event.body), 4096) }),
        color: COLORS[event.type] ?? COLORS.test,
      },
    ],
  }
}

export function apply(ctx: Context, config: Config) {
  const url = checkUrl(config.url)
  url.searchParams.set('wait', 'true')
  if (config.threadId) url.searchParams.set('thread_id', config.threadId)
  const id = `discord:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  const send = async (event: NotificationEvent, signal?: AbortSignal) => {
    await post(ctx, url.toString(), {
      body: JSON.stringify(payload(event, config.username)),
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
            body: 'If you can read this, Discord notifications work.',
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
