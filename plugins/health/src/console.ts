// Web console entry: System → Health.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { CheckStatus, HealthService } from './index'

export interface HealthData {
  level: CheckStatus['level']
  checks: CheckStatus[]
  intervalMinutes: number
  /** Runs every check now and returns once they are done. */
  run(): Promise<void>
}

export default function console_(ctx: Context, health: HealthService) {
  const snapshot = () => ({ level: health.level(), checks: health.list() })
  ctx.on('health/changed', () => entry.mutate((d) => Object.assign(d, snapshot())))

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/system/health'],
    },
    {
      ...snapshot(),
      intervalMinutes: health.config.intervalMinutes,
      async run() {
        await health.run()
      },
    } satisfies HealthData,
  )
}
