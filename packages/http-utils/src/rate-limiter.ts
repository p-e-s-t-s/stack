export interface RateLimit {
  /** Requests allowed per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

interface Bucket {
  tokens: number
  updatedAt: number
  queue: Promise<void>
}

/**
 * Token bucket per key (usually a hostname). `acquire()` resolves when a request
 * may be sent; callers for the same key are served in order.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>()

  constructor(
    private defaults: RateLimit,
    private overrides: Record<string, RateLimit> = {},
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  setLimit(key: string, limit: RateLimit) {
    this.overrides[key] = limit
  }

  acquire(key: string): Promise<void> {
    const { limit, windowMs } = this.overrides[key] ?? this.defaults
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { tokens: limit, updatedAt: this.now(), queue: Promise.resolve() }
      this.buckets.set(key, bucket)
    }
    const b = bucket
    const task = b.queue.then(async () => {
      const refill = () => {
        const now = this.now()
        b.tokens = Math.min(limit, b.tokens + ((now - b.updatedAt) * limit) / windowMs)
        b.updatedAt = now
      }
      refill()
      if (b.tokens < 1) {
        await this.sleep(Math.ceil(((1 - b.tokens) * windowMs) / limit))
        refill()
      }
      b.tokens -= 1
    })
    b.queue = task.catch(() => {})
    return task
  }
}
