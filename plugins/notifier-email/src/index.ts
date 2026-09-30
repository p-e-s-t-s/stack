// @magpiejs/notifier-email: sends each event as a plain-text and HTML email over SMTP.
// Certificates are always verified; the connection must use TLS (implicit or STARTTLS).

import type { NotificationEvent } from '@magpiejs/types'
import { eventConfig, type EventConfig, eventsOf } from '@magpiejs/notifications/config'
import type { Context } from 'cordis'
import { createTransport, type Transporter } from 'nodemailer'
import z from 'schemastery'

export const name = 'notifier-email'
export const inject = ['notifications']

export interface Config extends EventConfig {
  name: string
  host: string
  port: number
  security: 'tls' | 'starttls'
  username: string
  password: string
  from: string
  to: string
}

export const Config: z<Config> = z.object({
  name: z.string().default('Email').description('Name shown in Magpie.'),
  host: z.string().default('').description('SMTP server.'),
  port: z.natural().max(65535).default(587),
  security: z
    .union([z.const('tls' as const), z.const('starttls' as const)])
    .default('starttls')
    .description('`tls` for port 465 style servers, `starttls` for port 587 style servers.'),
  username: z.string().default(''),
  password: z.string().role('secret').default(''),
  from: z.string().default('').description('Sender address, e.g. `magpie@example.com`.'),
  to: z.string().default('').description('Recipients, separated by commas.'),
  ...eventConfig,
})

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** A header value with line breaks collapsed, so nothing in a title can add a header. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Addresses must be plain `name@host` (no display names, no line breaks, no groups). */
export function addresses(list: string, what: string) {
  const found = list
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
  if (!found.length) throw new Error(`${what} is empty`)
  for (const address of found)
    if (!/^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/.test(address))
      throw new Error(`${what} has an invalid address`)
  return found
}

/** The message for one delivery; the Message-ID is stable across its retries. */
export function message(
  event: NotificationEvent,
  config: Pick<Config, 'from' | 'to'>,
  deliveryId = 'test',
) {
  const [from] = addresses(config.from, 'the sender')
  const to = addresses(config.to, 'the recipient list')
  const domain = from!.split('@')[1]
  const text = event.body ? `${event.title}\n\n${event.body}\n` : `${event.title}\n`
  return {
    from: from!,
    to,
    subject: oneLine(event.title).slice(0, 200),
    messageId: `<magpie-${deliveryId}@${domain}>`,
    text,
    html: `<p><strong>${escapeHtml(event.title)}</strong></p>${
      event.body ? `<p>${escapeHtml(event.body)}</p>` : ''
    }`,
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.host) throw new Error('no SMTP server is set')
  // fail on bad addresses when it is enabled, not when the first event arrives
  message({ type: 'test', title: 'check' }, config)
  const id = `email:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  const transport: Transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  })
  ctx.effect(() => () => transport.close(), 'email.transport')
  ctx.notifications.register(
    {
      id,
      events: eventsOf(config),
      async send(event, options) {
        await transport.sendMail(message(event, config, options?.deliveryId))
      },
      async test() {
        try {
          await transport.sendMail(
            message(
              {
                type: 'test',
                title: 'Test message from Magpie',
                body: 'If you can read this, email notifications work.',
              },
              config,
              `test-${Date.now()}`,
            ),
          )
          return { ok: true, message: 'Sent' }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    { name: config.name },
  )
}
