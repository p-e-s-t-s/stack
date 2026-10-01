// Web console entry: the Import lists settings page (lists, last sync, unmatched titles, exclusions).

import type {} from '@magpiejs/webui'
import type { TestResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { ImportListsService, ListInfo } from './index'
import type { Exclusion, SeenRow } from './schema'

export interface ImportListsData {
  lists: ListInfo[]
  unmatched: SeenRow[]
  exclusions: Exclusion[]
  test(id: string): Promise<TestResult>
  sync(id: string): Promise<void>
  unexclude(key: string): Promise<void>
}

export default function console_(ctx: Context, importLists: ImportListsService) {
  const snapshot = () => ({
    lists: importLists.info(),
    unmatched: importLists.unmatched(),
    exclusions: importLists.exclusions(),
  })
  const refresh = ctx.debounce(() => entry.mutate((d) => Object.assign(d, snapshot())), 200)
  ctx.on('importlists/changed', refresh)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      access: { view: 'settings.manage' },
      routes: ['/settings/import-lists'],
    },
    {
      ...snapshot(),
      test: (id: string) => importLists.test(id),
      sync: async (id: string) => importLists.syncNow(id),
      unexclude: async (key: string) => importLists.unexclude(key),
    } satisfies ImportListsData,
  )
}
