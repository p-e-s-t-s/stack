import type {} from '@magpiejs/webui'
import type {} from '@magpiejs/history'
import type { Context } from 'cordis'
import type { ReviewKind, ReviewRow, ReviewService, ReviewSession } from './review'

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
  const refresh = () => entry.mutate((d) => Object.assign(d, snapshot()))
  const data: ImportData = {
    ...snapshot(),
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
}
