// Web console entry: the palette's lookup. It adds no page; the client fills the top bar.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { SearchHit, SearchService } from './index'

export interface SearchData {
  find(query: string): Promise<SearchHit[]>
}

export default function console_(ctx: Context, service: SearchService) {
  ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      access: { view: 'library.read' },
    },
    { find: async (query: string) => service.find(String(query)) } satisfies SearchData,
  )
}
