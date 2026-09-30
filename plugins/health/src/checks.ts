// The checks health registers itself: what the core services can tell, without the plugins
// that use them knowing about health. Each only runs when the service it looks at is loaded.

import { access, constants, stat, statfs } from 'node:fs/promises'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import type {} from '@magpiejs/library'
import { queue } from '@magpiejs/jobs/schema'
import type { Context } from 'cordis'
import { and, desc, eq, gt } from 'drizzle-orm'
import type { HealthService, Outcome } from './index'

const GB = 1024 ** 3
const DAY = 24 * 60 * 60_000

const ok = (message: string): Outcome => ({ level: 'ok', message })

function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`
}

export function builtIn(ctx: Context, health: HealthService) {
  health.check(
    'database',
    () => {
      const rows = ctx.database.sqlite.prepare('PRAGMA quick_check').all() as Record<
        string,
        string
      >[]
      const problems = rows.map((r) => Object.values(r)[0]!).filter((v) => v !== 'ok')
      if (!problems.length) return ok('The database passes its integrity check.')
      return {
        level: 'error',
        message: 'The database is damaged. Restore a backup (System → Backups).',
        details: problems.slice(0, 10),
      }
    },
    { label: 'Database', description: 'SQLite integrity check.', link: '/system/backups' },
  )

  health.check(
    'jobs',
    () => {
      const since = health.now() - DAY
      const failed = ctx.jobs.db
        .select()
        .from(queue)
        .where(and(eq(queue.status, 'failed'), gt(queue.updatedAt, since)))
        .orderBy(desc(queue.updatedAt))
        .all()
      if (!failed.length) return ok('No background job failed in the last day.')
      return {
        level: 'warning',
        message: `${plural(failed.length, 'background job')} failed in the last day.`,
        details: failed.slice(0, 10).map((j) => `${j.type}: ${j.lastError ?? 'unknown error'}`),
      }
    },
    { label: 'Background jobs', description: 'Jobs that ran out of retries.', link: '/system' },
  )

  ctx.inject(['library'], (ctx) => {
    health.check(
      'root-folders',
      async () => {
        const roots = ctx.library.rootFolders()
        if (!roots.length) return ok('No root folders are set up yet.')
        const minFree = health.config.minFreeGb * GB
        const errors: string[] = []
        const warnings: string[] = []
        for (const { path, kind } of roots) {
          const label = `${path} (${kind})`
          try {
            if (!(await stat(path)).isDirectory()) {
              errors.push(`${label} is not a folder`)
              continue
            }
            await access(path, constants.R_OK | constants.W_OK)
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            errors.push(
              code === 'ENOENT'
                ? `${label} does not exist (is the drive mounted?)`
                : code === 'EACCES' || code === 'EPERM'
                  ? `${label} is not writable by Magpie`
                  : `${label}: ${(error as Error).message}`,
            )
            continue
          }
          try {
            const fs = await statfs(path)
            const free = fs.bavail * fs.bsize
            const text = `${label} has ${(free / GB).toFixed(1)} GB free`
            if (free < minFree / 5) errors.push(text)
            else if (free < minFree) warnings.push(text)
          } catch {
            // free space is not available on every filesystem
          }
        }
        if (errors.length) {
          return {
            level: 'error',
            message: `${plural(errors.length, 'root folder')} cannot be used.`,
            details: [...errors, ...warnings],
          }
        }
        if (warnings.length) {
          return {
            level: 'warning',
            message: 'A root folder is running out of space.',
            details: warnings,
          }
        }
        return ok(
          `${plural(roots.length, 'root folder')} can be written to and ${roots.length === 1 ? 'has' : 'have'} room.`,
        )
      },
      {
        label: 'Root folders',
        description: 'Exist, can be written to, and have free space.',
        link: '/settings/media',
      },
    )
  })

  ctx.inject(['indexers'], (ctx) => {
    health.check(
      'indexers',
      () => {
        const all = ctx.indexers.health()
        if (!all.length) {
          return {
            level: 'warning',
            message: 'No indexers are set up, so Magpie cannot find releases.',
          }
        }
        const down = all.filter((i) => !i.healthy)
        if (!down.length) return ok(`${plural(all.length, 'indexer')} working.`)
        return {
          level: down.length === all.length ? 'error' : 'warning',
          message:
            down.length === all.length
              ? 'Every indexer is failing; Magpie is backing off from all of them.'
              : `${down.length} of ${all.length} indexers are failing; Magpie is backing off.`,
          details: down.map((i) => `${i.name}: ${i.lastError ?? 'failing'}`),
        }
      },
      {
        label: 'Indexers',
        description: 'Indexers Magpie is backing off from after repeated failures.',
        link: '/settings/indexers',
      },
    )
  })

  ctx.inject(['downloads'], (ctx) => {
    health.check(
      'download-clients',
      async () => {
        const clients = ctx.downloads.listClients()
        if (!clients.length) {
          return {
            level: 'warning',
            message: 'No download client is set up, so Magpie cannot download anything.',
          }
        }
        const results = await Promise.all(
          clients.map(async (c) => ({ name: c.name, ...(await ctx.downloads.testClient(c.id)) })),
        )
        const failing = results.filter((r) => !r.ok)
        if (!failing.length) return ok(`${plural(clients.length, 'download client')} reachable.`)
        return {
          level: 'error',
          message: `${failing.length} of ${plural(clients.length, 'download client')} cannot be reached.`,
          details: failing.map((r) => `${r.name}: ${r.message ?? 'failed'}`),
        }
      },
      {
        label: 'Download clients',
        description: 'Connects to every client and logs in.',
        link: '/settings/clients',
      },
    )

    health.check(
      'download-paths',
      async () => {
        // Finished downloads waiting for, or refused by, the import: if Magpie cannot see
        // the folder its client reported, the two run with different views of the disk.
        const stuck = ctx.downloads
          .recent(50)
          .filter((g) => g.outputPath && ['import_pending', 'import_failed'].includes(g.state))
        const missing: string[] = []
        for (const grab of stuck) {
          try {
            await access(grab.outputPath!)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(grab.outputPath!)
          }
        }
        if (!missing.length) return ok('Finished downloads are where the clients say they are.')
        return {
          level: 'warning',
          message:
            'Magpie cannot see where a download client put finished downloads. In Docker, ' +
            'mount the download folder at the same path in both containers.',
          details: [...new Set(missing)].slice(0, 10),
        }
      },
      {
        label: 'Download paths',
        description: 'Finished downloads are visible to Magpie at the path the client reported.',
        link: '/settings/clients',
      },
    )
  })
}
