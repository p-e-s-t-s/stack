// Web console entry: History page, and a history section on each movie's page.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { HistoryService } from './index'
import type { HistoryType } from './schema'

export interface HistoryRow {
  id: number
  mediaId: number
  mediaTitle: string
  type: HistoryType
  title: string
  data: Record<string, unknown>
  createdAt: number
}

export interface HistoryData {
  events: HistoryRow[]
}

export default function console_(ctx: Context, history: HistoryService) {
  const snapshot = () =>
    history.list({ limit: 500 }).map((e) => {
      const item = ctx.library.get(e.mediaId)
      return {
        ...e,
        mediaTitle: item ? `${item.title}${item.year ? ` (${item.year})` : ''}` : `#${e.mediaId}`,
      }
    })
  const refresh = () => entry.mutate((d) => void (d.events = snapshot()))
  ctx.on('history/added', refresh)
  ctx.on('library/deleted', refresh)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/history'],
    },
    { events: snapshot() } satisfies HistoryData,
  )
}
