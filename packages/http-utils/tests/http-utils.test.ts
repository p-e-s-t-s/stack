import { describe, expect, it } from 'vitest'
import { backoffDelay, RateLimiter, retry } from '../src'

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    sleeps,
  }
}

describe('RateLimiter', () => {
  it('allows a burst up to the limit, then waits', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000 }, {}, clock.now, clock.sleep)
    await limiter.acquire('a')
    await limiter.acquire('a')
    expect(clock.sleeps).toEqual([])
    await limiter.acquire('a')
    expect(clock.sleeps).toEqual([500])
  })

  it('keeps keys independent and honors overrides', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(
      { limit: 1, windowMs: 1000 },
      { slow: { limit: 1, windowMs: 10_000 } },
      clock.now,
      clock.sleep,
    )
    await limiter.acquire('a')
    await limiter.acquire('b')
    expect(clock.sleeps).toEqual([])
    await limiter.acquire('slow')
    await limiter.acquire('slow')
    expect(clock.sleeps).toEqual([10_000])
  })
})

describe('retry', () => {
  it('retries until success with growing delays', async () => {
    const sleeps: number[] = []
    let calls = 0
    const result = await retry(
      async () => {
        if (++calls < 3) throw new Error('fail')
        return 'ok'
      },
      { attempts: 5, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms), random: () => 1 },
    )
    expect(result).toBe('ok')
    expect(sleeps).toEqual([100, 200])
  })

  it('stops when shouldRetry says no', async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error('404')
        },
        { attempts: 5, baseDelayMs: 1, shouldRetry: () => false, sleep: async () => {} },
      ),
    ).rejects.toThrow('404')
    expect(calls).toBe(1)
  })

  it('caps the delay', () => {
    expect(backoffDelay(10, 100, 1000, () => 1)).toBe(1000)
    expect(backoffDelay(1, 100, 1000, () => 0)).toBe(50)
  })
})
