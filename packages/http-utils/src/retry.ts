export interface RetryOptions {
  /** Total attempts including the first one. */
  attempts: number
  /** Delay before the second attempt; doubles each time. */
  baseDelayMs: number
  maxDelayMs?: number
  /** Return false to stop retrying (e.g. for HTTP 4xx). */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs = Infinity,
  random = Math.random,
) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  // full jitter between 50% and 100% of the exponential delay
  return Math.round(exp / 2 + (random() * exp) / 2)
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError: unknown
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt === options.attempts) break
      if (options.shouldRetry && !options.shouldRetry(error, attempt)) break
      await sleep(backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs, options.random))
    }
  }
  throw lastError
}
