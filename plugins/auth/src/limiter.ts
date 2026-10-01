// Counts failures per key (an address, a username) in a fixed window and says when a key
// has to wait. Old keys are dropped as new ones arrive, so the map cannot grow forever.

export class FailureLimiter {
  private failures = new Map<string, { count: number; since: number }>()

  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  blocked(key: string, now = Date.now()) {
    this.prune(now)
    return (this.failures.get(key)?.count ?? 0) >= this.max
  }

  fail(key: string, now = Date.now()) {
    this.prune(now)
    const current = this.failures.get(key)
    this.failures.set(key, { count: (current?.count ?? 0) + 1, since: current?.since ?? now })
  }

  clear(key: string) {
    this.failures.delete(key)
  }

  private prune(now: number) {
    for (const [key, value] of this.failures) {
      if (now - value.since > this.windowMs) this.failures.delete(key)
    }
  }
}
