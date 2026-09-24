// Web console entry: the Metadata settings page.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { MetadataService } from './index'

export interface MetadataData {
  providers: { id: string; kinds: string[] }[]
}

export default function console_(ctx: Context, metadata: MetadataService) {
  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/metadata'],
    },
    { providers: metadata.list() } satisfies MetadataData,
  )
  ctx.on('metadata/providers', () => entry.mutate((d) => (d.providers = metadata.list())))
}
