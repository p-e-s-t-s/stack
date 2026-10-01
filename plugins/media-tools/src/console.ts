// Web console entry: Settings → Video and audio tools.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { MediaToolsService, Status } from './index'
import type { Paths } from './schema'

export interface MediaToolsData {
  settings: Paths
  status: Status
  /** Saves the paths and checks them. */
  save(paths: Paths): Promise<Status>
  /** Checks the saved paths again. */
  test(): Promise<Status>
}

export default function console_(ctx: Context, tools: MediaToolsService) {
  const refresh = () =>
    entry.mutate((d) => {
      d.settings = tools.settings()
      d.status = tools.status
    })
  ctx.on('media-tools/changed', refresh)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      access: { view: 'settings.manage' },
      routes: ['/settings/media-tools'],
    },
    {
      settings: tools.settings(),
      status: tools.status,
      save: (paths) => tools.save(paths),
      test: () => tools.check(),
    } satisfies MediaToolsData,
  )
}
