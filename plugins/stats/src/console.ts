// Web console entry: the Statistics page.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { Stats, StatsService } from './index'

export interface StatsData {
  stats: Stats
}

export default function console_(ctx: Context, service: StatsService) {
  const refresh = ctx.debounce(() => entry.mutate((d) => void (d.stats = service.snapshot())), 1000)
  for (const event of [
    'library/added',
    'library/deleted',
    'library/updated',
    'library/file-added',
    'library/file-removed',
    'history/added',
  ] as const)
    ctx.on(event, refresh)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      access: { view: 'library.read' },
      routes: ['/stats'],
    },
    { stats: service.snapshot() } satisfies StatsData,
  )
}
