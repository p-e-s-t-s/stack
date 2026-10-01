// Statistics: how big the library is per kind, what quality the files are, and how many
// downloads and imports happened each day. Read-only; it owns no tables.

import { mediaFiles, mediaItems } from '@magpiejs/library/schema'
import { count, sql, sum } from 'drizzle-orm'
import { type Context, Service } from 'cordis'
import type {} from '@magpiejs/decision'
import type {} from '@magpiejs/history'
import type {} from '@magpiejs/library'
import type { MediaKind } from '@magpiejs/types'

declare module 'cordis' {
  interface Context {
    stats: StatsService
  }
}

export interface KindStats {
  kind: string
  label: string
  items: number
  monitored: number
  /** Items with at least one file. */
  withFiles: number
  files: number
  bytes: number
}

export interface QualityStats {
  quality: string
  files: number
  bytes: number
}

export interface DayStats {
  /** ISO date, local to the server. */
  day: string
  grabbed: number
  imported: number
  failed: number
}

export interface Stats {
  kinds: KindStats[]
  qualities: QualityStats[]
  days: DayStats[]
  totals: { items: number; files: number; bytes: number }
}

const DAY = 86_400_000

export const isoDay = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export class StatsService extends Service {
  static inject = ['library', 'decision']

  /** Overridable for tests. */
  now = () => Date.now()

  constructor(ctx: Context) {
    super(ctx, 'stats')
  }

  [Service.init]() {
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  /** Counts for the last `days` days; history is optional. */
  snapshot(days = 30): Stats {
    const db = this.ctx.library.db
    const itemRows = db
      .select({
        kind: mediaItems.kind,
        items: count(),
        monitored: sql<number>`coalesce(sum(${mediaItems.monitored}), 0)`,
      })
      .from(mediaItems)
      .groupBy(mediaItems.kind)
      .all()
    const fileRows = db
      .select({
        kind: mediaItems.kind,
        files: count(),
        bytes: sql<number>`coalesce(${sum(mediaFiles.size)}, 0)`,
        withFiles: sql<number>`count(distinct ${mediaFiles.mediaId})`,
      })
      .from(mediaFiles)
      .innerJoin(mediaItems, sql`${mediaItems.id} = ${mediaFiles.mediaId}`)
      .groupBy(mediaItems.kind)
      .all()
    const byKind = new Map(fileRows.map((r) => [r.kind, r]))
    // registered kinds, plus any kind that still has rows after its plugin was disabled
    const labels = new Map<MediaKind, string>(this.ctx.library.kinds().map((k) => [k.id, k.label]))
    for (const r of itemRows) if (!labels.has(r.kind)) labels.set(r.kind, r.kind)
    const kinds = [...labels].map(([kind, label]): KindStats => {
      const i = itemRows.find((r) => r.kind === kind)
      const f = byKind.get(kind)
      return {
        kind,
        label,
        items: i?.items ?? 0,
        monitored: Number(i?.monitored ?? 0),
        withFiles: Number(f?.withFiles ?? 0),
        files: f?.files ?? 0,
        bytes: Number(f?.bytes ?? 0),
      }
    })

    const qualities = db
      .select({
        quality: mediaFiles.quality,
        files: count(),
        bytes: sql<number>`coalesce(${sum(mediaFiles.size)}, 0)`,
      })
      .from(mediaFiles)
      .groupBy(mediaFiles.quality)
      .all()
      .map((q) => ({
        quality: this.ctx.decision.qualityName(q.quality) ?? q.quality,
        files: q.files,
        bytes: Number(q.bytes),
      }))
      .sort((a, b) => b.files - a.files)

    return {
      kinds,
      qualities,
      days: this.activity(days),
      totals: {
        items: kinds.reduce((n, k) => n + k.items, 0),
        files: kinds.reduce((n, k) => n + k.files, 0),
        bytes: kinds.reduce((n, k) => n + k.bytes, 0),
      },
    }
  }

  private activity(days: number): DayStats[] {
    const now = this.now()
    const out = new Map<string, DayStats>()
    for (let i = days - 1; i >= 0; i--) {
      const day = isoDay(now - i * DAY)
      out.set(day, { day, grabbed: 0, imported: 0, failed: 0 })
    }
    const history = this.ctx.get('history')
    if (!history) return [...out.values()]
    const since = now - days * DAY
    for (const e of history.list({ limit: 20_000 })) {
      if (e.createdAt < since) continue
      const row = out.get(isoDay(e.createdAt))
      if (!row) continue
      if (e.type === 'grabbed') row.grabbed++
      else if (e.type === 'imported') row.imported++
      else if (e.type === 'download-failed' || e.type === 'import-failed') row.failed++
    }
    return [...out.values()]
  }
}

import console_ from './console'

export default StatsService
