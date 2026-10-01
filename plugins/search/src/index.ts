// Search: finds library titles by name for the console's Ctrl+K palette. Read-only; it
// owns no tables. Kinds say where their pages live through `registerKind`.

import { mediaItems } from '@magpiejs/library/schema'
import { sortTitle } from '@magpiejs/library'
import type { MediaKind } from '@magpiejs/types'
import { like } from 'drizzle-orm'
import { type Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    search: SearchService
  }
}

export interface SearchHit {
  id: number
  kind: MediaKind
  kindLabel: string
  title: string
  year: number | null
  /** Console page of the item. */
  path: string
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export class SearchService extends Service {
  static inject = ['library']

  constructor(ctx: Context) {
    super(ctx, 'search')
  }

  [Service.init]() {
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  /** Titles containing the query, best matches (prefix, then shorter) first. */
  find(query: string, limit = 12): SearchHit[] {
    const q = sortTitle(query.slice(0, 100))
    if (!q) return []
    const kinds = new Map(this.ctx.library.kinds().map((k) => [k.id, k]))
    const rows = this.ctx.library.db
      .select()
      .from(mediaItems)
      .where(like(mediaItems.sortTitle, `%${escapeLike(q)}%`))
      .limit(200)
      .all()
    const hits: { hit: SearchHit; rank: number }[] = []
    for (const r of rows) {
      const info = kinds.get(r.kind)
      const base = info?.browse?.detailPath ?? info?.detailPath
      if (!base) continue // the kind's plugin is off, so there is no page to open
      hits.push({
        rank: (r.sortTitle.startsWith(q) ? 0 : 1000) + r.sortTitle.length,
        hit: {
          id: r.id,
          kind: r.kind,
          kindLabel: info!.label,
          title: r.title,
          year: r.year,
          path: `${base}/${r.id}`,
        },
      })
    }
    return hits
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
      .map((h) => h.hit)
  }
}

import console_ from './console'

export default SearchService
