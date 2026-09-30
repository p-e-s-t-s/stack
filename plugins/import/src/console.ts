import type {} from '@magpiejs/webui'
import type {} from '@magpiejs/history'
import type { Context } from 'cordis'
import { basename } from 'node:path'
import type { ReviewKind, ReviewRow, ReviewService, ReviewSession } from './review'
import type { UndoState, UndoTarget } from './undo'

/** The imports of one batch (a download, a season pack, a review commit), for the undo list. */
export interface OperationBatch {
  batchId: string
  createdAt: number
  /** What was imported: the library items, or the file name for one file. */
  title: string
  count: number
  state: UndoState
}

export interface ImportData {
  kinds: ReviewKind[]
  items: { id: number; title: string; kind: string; path: string }[]
  profiles: { id: number; name: string }[]
  qualities: { id: string; name: string }[]
  sessions: ReviewSession[]
  failed: { id: number; title: string; mediaId: number; error: string | null }[]
  scan(options: {
    kind: ReviewKind
    mode: ReviewSession['mode']
    path: string
    mediaId?: number
  }): Promise<ReviewSession>
  preview(
    id: number,
    rows: ReviewRow[],
    transfer: ReviewSession['transfer'],
    removeMissing: boolean,
  ): Promise<ReviewSession>
  commit(id: number): Promise<ReviewSession>
  lookup(kind: ReviewKind, term: string): Promise<ReviewRow['suggestions']>
  episodes(
    kind: ReviewKind,
    id: number,
  ): Promise<{ id: number; season: number; number: number; title: string | null }[]>
  repairGrab(id: number): Promise<ReviewSession>
  /** Recent batches of file operations, newest first. */
  operations: OperationBatch[]
  /** The files an undo would move, and what stands in the way. */
  undoPlan(target: UndoTarget): Promise<{ lines: string[]; problems: string[] }>
  /** Undoes a batch or one import; refusals come back as `reasons`, not exceptions. */
  undo(target: UndoTarget): Promise<{ ok: boolean; reasons: string[]; warnings: string[] }>
}

export default function console_(ctx: Context, review: ReviewService) {
  const snapshot = () => ({
    kinds: review.kinds(),
    items: ctx.library
      .list()
      .filter((i) => review.kinds().includes(i.kind as ReviewKind))
      .map((i) => ({ id: i.id, title: i.title, kind: i.kind, path: ctx.library.folderOf(i) })),
    profiles: ctx.decision
      .profiles()
      .filter((p) => p.family === 'video')
      .map((p) => ({ id: p.id, name: p.name })),
    qualities: ctx.decision.families().find((f) => f.id === 'video')?.qualities ?? [],
    sessions: review.list(),
    failed: ctx.downloads
      .recent()
      .filter((g) => g.state === 'import_failed')
      .map((g) => ({ id: g.id, title: g.title, mediaId: g.mediaId, error: g.error })),
  })
  const batches = (): OperationBatch[] => {
    const seen = new Map<string, ReturnType<typeof ctx.import.journal.list>>()
    for (const op of ctx.import.journal.list({ limit: 300 })) {
      if (op.status === 'abandoned') continue
      seen.set(op.batchId, [...(seen.get(op.batchId) ?? []), op])
    }
    return [...seen.entries()].slice(0, 50).map(([batchId, ops]) => {
      const titles = [
        ...new Set(ops.map((o) => ctx.library.get(o.mediaId)?.title ?? `#${o.mediaId}`)),
      ]
      return {
        batchId,
        createdAt: Math.max(...ops.map((o) => o.createdAt)),
        title:
          ops.length === 1 ? basename(ops[0]!.dest) : `${ops.length} files · ${titles.join(', ')}`,
        count: ops.length,
        state: ctx.import.undo.state({ batchId }),
      }
    })
  }
  const refresh = () => entry.mutate((d) => Object.assign(d, snapshot(), { operations: batches() }))
  const data: ImportData = {
    ...snapshot(),
    operations: batches(),
    undoPlan: (target) => ctx.import.undo.plan(target),
    async undo(target) {
      try {
        const outcomes = await ctx.import.undo.run(target)
        return {
          ok: outcomes.every((o) => o.ok),
          reasons: outcomes.flatMap((o) => (o.reason ? [o.reason] : [])),
          warnings: outcomes.flatMap((o) => o.warnings),
        }
      } finally {
        refresh()
      }
    },
    async scan(options) {
      const s = await review.scan(options)
      refresh()
      return s
    },
    async preview(id, rows, transfer, missing) {
      const s = await review.preview(id, rows, transfer, missing)
      refresh()
      return s
    },
    async commit(id) {
      try {
        return await review.commit(id)
      } finally {
        refresh()
      }
    },
    lookup: (kind, term) => review.lookup(kind, term),
    async episodes(kind, id) {
      return review.adapter(kind).episodes?.(id) ?? []
    },
    async repairGrab(id) {
      const grab = ctx.downloads.get(id)
      if (!grab || !['import_failed', 'import_pending'].includes(grab.state) || !grab.outputPath)
        throw new Error('download is not ready for repair')
      const item = ctx.library.get(grab.mediaId)
      if (!item || !review.kinds().includes(item.kind as ReviewKind))
        throw new Error('media kind is not supported')
      const session = await review.scan({
        kind: item.kind as ReviewKind,
        mode: 'manual',
        path: grab.outputPath,
        mediaId: item.id,
        grabId: grab.id,
      })
      for (const row of session.rows) {
        row.quality = grab.quality
        row.mediaId = item.id
      }
      review.save(session)
      refresh()
      return session
    },
  }
  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/import'],
    },
    data,
  )
  ctx.on('library/added', refresh)
  ctx.on('library/updated', refresh)
  ctx.on('library/kinds', refresh)
  ctx.on('downloads/updated', refresh)
  ctx.on('import/adapters', refresh)
  ctx.on('import/review', refresh)
  ctx.on('library/deleted', refresh)
  ctx.on('import/completed', refresh)
  ctx.on('media/changed', refresh)
}
