// Small web helpers shared by auth and its identity providers. This file imports nothing
// from the rest of auth, so provider plugins can use it without a dependency cycle.

import type { Request, Response } from '@cordisjs/plugin-server'

/** The session cookie. */
export const COOKIE = 'magpie_session'

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export function readCookie(header: string | null, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || undefined
  }
}

export async function readForm(req: Request) {
  return new URLSearchParams(await req.text())
}

/** Only same-site paths, so the login page can't be used to send people elsewhere. */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/'
}

export function redirect(res: Response, location: string) {
  res.status = 303
  res.headers.set('location', location)
}

export function html(res: Response, body: string) {
  res.status = 200
  res.headers.set('content-type', 'text/html; charset=utf-8')
  res.headers.set('cache-control', 'no-store')
  res.body = body
}

/** Counts failures per key (an address, a username) in a window and says when to wait. */
export class FailureLimiter {
  private failures = new Map<string, { count: number; since: number }>()

  constructor(
    private max = 10,
    private windowMs = 15 * 60_000,
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

  /** Old keys are dropped as new ones arrive, so the map cannot grow forever. */
  private prune(now: number) {
    for (const [key, value] of this.failures) {
      if (now - value.since > this.windowMs) this.failures.delete(key)
    }
  }
}
