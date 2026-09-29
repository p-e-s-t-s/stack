import { RateLimiter } from '@magpiejs/http-utils'
import { SubtitleProviderError } from '@magpiejs/types'
import { MAX_SUBTITLE } from './files'

const limiter = new RateLimiter({ limit: 1, windowMs: 1000 })
export async function request(url: string, init: RequestInit, signal: AbortSignal) {
  await limiter.acquire(new URL(url).hostname)
  signal.throwIfAborted()
  let response: Response
  try { response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: 'error' }) }
  catch { signal.throwIfAborted(); throw new SubtitleProviderError('temporary', 'provider request failed') }
  if (!response.ok) {
    const retry = response.headers.get('retry-after')
    const retryAt = retry ? /^\d+$/.test(retry) ? Date.now() + +retry * 1000 : Date.parse(retry) : undefined
    await response.body?.cancel()
    throw new SubtitleProviderError(response.status === 401 ? 'auth' : response.status === 403 ? 'quota' : response.status === 429 ? 'rate-limit' : 'temporary', `provider returned HTTP ${response.status}`, retryAt && Number.isFinite(retryAt) ? retryAt : undefined)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new SubtitleProviderError('invalid', 'empty provider response')
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_SUBTITLE) throw new SubtitleProviderError('invalid', 'provider response exceeds size limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return { response, bytes: Buffer.concat(chunks) }
}
export async function json(url: string, init: RequestInit, signal: AbortSignal) {
  const { bytes } = await request(url, init, signal)
  try { return JSON.parse(bytes.toString('utf8')) }
  catch { throw new SubtitleProviderError('invalid', 'provider returned invalid JSON') }
}
