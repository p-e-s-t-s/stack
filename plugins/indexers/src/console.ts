// Web console entry: Indexers page (health and connection tests). Adding and editing
// indexers comes with the Settings pages (Phase 3 step 7).

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { IndexerHealth, IndexersService } from './index'

export interface IndexersData {
  indexers: IndexerHealth[]
  test(id: string): Promise<{ ok: boolean; message?: string }>
}

export default function console_(ctx: Context, indexers: IndexersService) {
  const refresh = () => entry.mutate((d) => void (d.indexers = indexers.health()))
  ctx.on('indexers/changed', refresh)
  const timer = setInterval(refresh, 30_000)
  ctx.effect(() => () => clearInterval(timer))

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/indexers'],
    },
    {
      indexers: indexers.health(),
      async test(id: string) {
        const result = await indexers.test(id)
        if (result.ok) indexers.succeeded(id)
        refresh()
        return result
      },
    } satisfies IndexersData,
  )
}
