// @magpiejs/health: the System → Health page. Plugins register checks ("can I reach my
// download client?", "is there room on the disk?"); this runs them on a schedule and on
// demand and keeps the latest result of each. Checks only report: nothing here fixes or
// disables anything.

import type {} from '@magpiejs/api'
import type {} from '@magpiejs/database'
import type {} from '@magpiejs/jobs'
import { type Context, Service } from 'cordis'
import z from 'schemastery'
import { builtIn } from './checks'
import console_ from './console'

declare module 'cordis' {
  interface Context {
    health: HealthService
  }
  interface Events {
    /** A check finished, or one was added or removed. */
    'health/changed'(): void
  }
}

export type Level = 'ok' | 'warning' | 'error'

export interface Outcome {
  level: Level
  /** One line: what is wrong, or that all is well. */
  message: string
  /** What exactly, one item per line (a folder, an indexer, a job). */
  details?: string[]
}

export type CheckFn = (signal: AbortSignal) => Outcome | Promise<Outcome>

export interface CheckOptions {
  label?: string
  description?: string
  /** Console page where the problem is fixed, e.g. `/settings/clients`. */
  link?: string
}

export interface CheckStatus extends Omit<Outcome, 'level'> {
  name: string
  label: string
  description: string
  link?: string
  /** `unknown` until the check has run once. */
  level: Level | 'unknown'
  checkedAt: number | null
  durationMs: number | null
}

export interface HealthConfig {
  intervalMinutes: number
  timeoutSeconds: number
  minFreeGb: number
}

export const HealthConfig: z<Partial<HealthConfig>, HealthConfig> = z.object({
  intervalMinutes: z.natural().min(1).default(15).description('Minutes between health checks.'),
  timeoutSeconds: z.natural().min(1).default(30).description('A check that takes longer fails.'),
  minFreeGb: z
    .natural()
    .default(10)
    .description(
      'Warn when a library folder has less free space than this (an error below a fifth of it).',
    ),
})

const RANK: Record<Level | 'unknown', number> = { unknown: -1, ok: 0, warning: 1, error: 2 }

export function worst(levels: (Level | 'unknown')[]): Level | 'unknown' {
  return levels.reduce<Level | 'unknown'>((a, b) => (RANK[b] > RANK[a] ? b : a), 'unknown')
}

export class HealthService extends Service {
  static inject = ['database', 'jobs']
  static Config = HealthConfig

  config: HealthConfig
  now = () => Date.now()
  private checks = new Map<string, { fn: CheckFn; options: CheckOptions; status: CheckStatus }>()

  constructor(ctx: Context, config: Partial<HealthConfig> = {}) {
    super(ctx, 'health')
    this.config = HealthConfig(config)
  }

  [Service.init]() {
    this.ctx.jobs.define('health.run', async () => void (await this.run()))
    this.ctx.jobs.schedule('health', 'health.run', this.config.intervalMinutes * 60_000)
    // other plugins register their checks as they load; look once they have
    this.ctx.jobs.enqueue('health.run', undefined, {
      runAt: this.now() + 5000,
      dedupeKey: 'health.startup',
    })
    builtIn(this.ctx, this)
    this.ctx.inject(['api'], (ctx) => {
      ctx.api.get('/health', () => ({ level: this.level(), checks: this.list() }))
      ctx.api.post('/health/run', async () => {
        await this.run()
        return { level: this.level(), checks: this.list() }
      })
    })
    this.ctx.inject(['webui', 'jobs'], (ctx) => void ctx.plugin(console_, this))
  }

  /** Adds a check, for the caller's lifetime. It runs with the next pass. */
  check(name: string, fn: CheckFn, options: CheckOptions = {}) {
    return this.ctx.effect(() => {
      if (this.checks.has(name)) throw new Error(`health check ${name} is already registered`)
      this.checks.set(name, {
        fn,
        options,
        status: {
          name,
          label: options.label ?? name,
          description: options.description ?? '',
          link: options.link,
          level: 'unknown',
          message: 'Not checked yet',
          checkedAt: null,
          durationMs: null,
        },
      })
      this.ctx.emit('health/changed')
      return () => {
        this.checks.delete(name)
        this.ctx.emit('health/changed')
      }
    }, `health.check(${name})`)
  }

  list(): CheckStatus[] {
    return [...this.checks.values()].map((c) => structuredClone(c.status))
  }

  /** The worst level among the checks. */
  level() {
    return worst([...this.checks.values()].map((c) => c.status.level))
  }

  /** Runs one check, or all of them side by side. A check that throws or times out is an error. */
  async run(name?: string) {
    const names = name ? [name] : [...this.checks.keys()]
    if (name && !this.checks.has(name)) throw new Error(`no health check ${name}`)
    await Promise.all(names.map((n) => this.runOne(n)))
    this.ctx.emit('health/changed')
    return this.list()
  }

  private async runOne(name: string) {
    const entry = this.checks.get(name)
    if (!entry) return
    const started = this.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutSeconds * 1000)
    let outcome: Outcome
    try {
      outcome = await Promise.race([
        Promise.resolve().then(() => entry.fn(controller.signal)),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () =>
            reject(new Error(`took longer than ${this.config.timeoutSeconds} s`)),
          ),
        ),
      ])
    } catch (error) {
      outcome = {
        level: 'error',
        message: `The check itself failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      clearTimeout(timer)
    }
    // a check removed while it ran keeps no result
    if (this.checks.get(name) !== entry) return
    entry.status = {
      ...entry.status,
      level: outcome.level,
      message: outcome.message,
      details: outcome.details,
      checkedAt: this.now(),
      durationMs: this.now() - started,
    }
  }
}

export default HealthService
