// Web console entry: History page, and a history section on each movie's page.

import type {} from '@magpiejs/webui'
import type { UndoState } from '@magpiejs/import'
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
  /** For imports that can be undone. */
  undo?: UndoState
}

export interface HistoryData {
  events: HistoryRow[]
  /** The files an undo of this event would move, and what stands in the way. */
  undoPlan(id: number): Promise<{ lines: string[]; problems: string[] }>
  /** Undoes the import of an event; refusals come back as `reason`s, not exceptions. */
  undo(id: number): Promise<{ ok: boolean; reasons: string[]; warnings: string[] }>
}

export default function console_(ctx: Context, history: HistoryService) {
  /** What to undo for an imported event: its own operation, else its whole batch. */
  const targetOf = (data: Record<string, unknown>) =>
    typeof data.operationId === 'number'
      ? { operationId: data.operationId }
      : typeof data.batchId === 'string'
        ? { batchId: data.batchId }
        : undefined
  const eventTarget = (id: number) => {
    const event = history.list({ limit: 500 }).find((e) => e.id === id)
    const target = event && event.type === 'imported' ? targetOf(event.data) : undefined
    if (!target) throw new Error('this import was not recorded, so it cannot be undone')
    return target
  }
  const snapshot = (): HistoryRow[] =>
    history.list({ limit: 500 }).map((e) => {
      const item = ctx.library.get(e.mediaId)
      const target = e.type === 'imported' ? targetOf(e.data) : undefined
      return {
        ...e,
        mediaTitle: item ? `${item.title}${item.year ? ` (${item.year})` : ''}` : `#${e.mediaId}`,
        undo: target ? ctx.import.undo.state(target) : undefined,
      }
    })
  const refresh = () => entry.mutate((d) => void (d.events = snapshot()))
  ctx.on('history/added', refresh)
  ctx.on('library/deleted', refresh)

  const data: HistoryData = {
    events: snapshot(),
    undoPlan: async (id) => ctx.import.undo.plan(eventTarget(id)),
    async undo(id) {
      const outcomes = await ctx.import.undo.run(eventTarget(id))
      refresh()
      return {
        ok: outcomes.every((o) => o.ok),
        reasons: outcomes.flatMap((o) => (o.reason ? [o.reason] : [])),
        warnings: outcomes.flatMap((o) => o.warnings),
      }
    },
  }
  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/history'],
    },
    data,
  )
}
