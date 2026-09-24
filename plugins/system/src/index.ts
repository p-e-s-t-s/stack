// @magpiejs/system: the System → Status page. Uptime, background jobs (with recent
// failures) and, for troubleshooting, each plugin's database migrations.

import type {} from '@cordisjs/plugin-webui'
import type {} from '@magpiejs/database'
import type {} from '@magpiejs/jobs'
import { queue } from '@magpiejs/jobs/schema'
import type { Context } from 'cordis'
import { desc, eq, sql } from 'drizzle-orm'

export const name = 'system'
export const inject = ['webui', 'database', 'jobs']

export interface SystemData {
  startedAt: number
  now: number
  namespaces: { namespace: string; active: boolean; migrations: number }[]
  jobs: Record<string, number>
  failed: { id: number; type: string; error: string | null; at: number }[]
}

export function apply(ctx: Context) {
  const startedAt = Date.now()

  const jobCounts = () =>
    Object.fromEntries(
      ctx.jobs.db
        .select({ status: queue.status, count: sql<number>`count(*)` })
        .from(queue)
        .groupBy(queue.status)
        .all()
        .map((row) => [row.status, row.count]),
    )

  const failed = () =>
    ctx.jobs.db
      .select()
      .from(queue)
      .where(eq(queue.status, 'failed'))
      .orderBy(desc(queue.updatedAt))
      .limit(10)
      .all()
      .map((j) => ({ id: j.id, type: j.type, error: j.lastError, at: j.updatedAt }))

  const namespaces = () =>
    ctx.database.status().map((s) => ({
      namespace: s.namespace,
      active: !!s.active,
      migrations: s.applied.length,
    }))

  const snapshot = () => ({
    now: Date.now(),
    jobs: jobCounts(),
    failed: failed(),
    namespaces: namespaces(),
  })

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/system'],
    },
    { startedAt, ...snapshot() } satisfies SystemData,
  )

  const timer = setInterval(() => entry.mutate((d) => Object.assign(d, snapshot())), 5000)
  ctx.effect(() => () => clearInterval(timer), 'system refresh')
}
