// What notifier plugins share to reach their service over HTTP.

import type {} from '@cordisjs/plugin-http'
import type { Context } from 'cordis'

/**
 * POSTs to a notifier's endpoint and throws unless it accepts. Errors name the status, never
 * the URL (webhook URLs are secrets). 429 and 5xx are worth retrying; the job queue does that
 * for any thrown error, so the message only has to be honest.
 */
export async function post(
  ctx: Context,
  url: string,
  options: { body: string; headers?: Record<string, string>; signal?: AbortSignal },
) {
  const response = await ctx.http(url, {
    method: 'POST',
    data: options.body,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    validateStatus: () => true,
    timeout: 30_000,
    signal: options.signal,
  } as never)
  if (response.status >= 200 && response.status < 300) return response
  if (response.status === 401 || response.status === 403)
    throw new Error(`refused (HTTP ${response.status}): check the credentials`)
  if (response.status === 404) throw new Error('not found (HTTP 404): check the address')
  throw new Error(`HTTP ${response.status}`)
}

/** `http://localhost` style addresses only; rejects other schemes and embedded credentials. */
export function checkUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('the URL must start with http:// or https://')
  if (url.username || url.password)
    throw new Error('put credentials in their own fields, not the URL')
  return url
}
