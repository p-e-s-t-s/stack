// Web console entry: the Media servers settings page.

import type {} from '@magpiejs/webui'
import type { TestResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { MediaServersService, ServerStatus } from './index'

export interface MediaServersData {
  servers: ServerStatus[]
  test(id: string): Promise<TestResult>
  testRefresh(id: string, path: string): Promise<TestResult>
}

export default function console_(ctx: Context, servers: MediaServersService) {
  const refresh = ctx.debounce(() => entry.mutate((d) => void (d.servers = servers.list())), 200)
  ctx.on('mediaservers/changed', refresh)
  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/media-servers'],
    },
    {
      servers: servers.list(),
      test: (id: string) => servers.test(id),
      testRefresh: (id: string, path: string) => servers.testRefresh(id, path),
    } satisfies MediaServersData,
  )
}
