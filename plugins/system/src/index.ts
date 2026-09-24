// @magpiejs/system: the System page. Shows database namespaces and the job queue live,
// runs a test job, and edits the jobs plugin's settings at runtime through the loader.

import type {} from '@cordisjs/plugin-webui'
import type { Entry, EntryTree } from '@cordisjs/plugin-loader'
import { JobsConfig } from '@magpiejs/jobs'
import type { Context } from 'cordis'
import { sql } from 'drizzle-orm'
import { queue } from '@magpiejs/jobs/schema'

export const name = 'system'
export const inject = ['webui', 'database', 'jobs', 'loader']

export interface SystemData {
  startedAt: number
  now: number
  namespaces: { namespace: string; active: number; migrations: number }[]
  jobs: Record<string, number>
  jobsConfig: unknown
  jobsSchema: unknown
  runTestJob(): Promise<number>
  saveJobsConfig(config: unknown): Promise<void>
}

function* walk(tree: EntryTree): Generator<Entry> {
  for (const entry of tree.entries()) {
    yield entry
    if (entry.subtree) yield* walk(entry.subtree)
  }
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

  const namespaces = () =>
    ctx.database.status().map((s) => ({
      namespace: s.namespace,
      active: s.active,
      migrations: s.applied.length,
    }))

  ctx.jobs.define('system.ping', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  })

  const data: SystemData = {
    startedAt,
    now: Date.now(),
    namespaces: namespaces(),
    jobs: jobCounts(),
    jobsConfig: ctx.jobs.config,
    jobsSchema: JobsConfig.toJSON(),
    async runTestJob() {
      return ctx.jobs.enqueue('system.ping')
    },
    async saveJobsConfig(config) {
      const entry = [...walk(ctx.loader)].find((e) => e.options.name === '@magpiejs/jobs')
      if (!entry) throw new Error('the jobs plugin is not managed by the config file')
      await ctx.loader.update(entry.id, { config: JobsConfig(config as Partial<JobsConfig>) })
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/system'],
    },
    data,
  )

  const timer = setInterval(() => {
    entry.mutate((d) => {
      d.now = Date.now()
      d.jobs = jobCounts()
      d.namespaces = namespaces()
    })
  }, 1000)
  ctx.effect(() => () => clearInterval(timer), 'system refresh')
}
