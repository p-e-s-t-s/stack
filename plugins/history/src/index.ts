// @magpiejs/history: records what happened to each library item (grabs, failures, imports).

import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/decision'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/import'
import { type Context, Service } from 'cordis'
import { desc, eq } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    history: HistoryService
  }
  interface Events {
    'history/added'(event: schema.HistoryEvent): void
  }
}

export class HistoryService extends Service {
  static inject = ['database', 'library', 'decision']

  db!: Drizzle<typeof schema>

  constructor(ctx: Context) {
    super(ctx, 'history')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'history',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    const quality = (q: string) => this.ctx.decision.qualityName(q)
    this.ctx.on('downloads/grabbed', (g) =>
      this.add(g.mediaId, 'grabbed', g.title, {
        quality: quality(g.quality),
        indexer: g.release.indexerId,
        manual: g.manual,
      }),
    )
    this.ctx.on('downloads/failed', (g) =>
      this.add(g.mediaId, 'download-failed', g.title, { reason: g.error }),
    )
    this.ctx.on('import/completed', (item, g, result) =>
      this.add(item.id, 'imported', g.title, { quality: quality(g.quality), ...result }),
    )
    this.ctx.on('import/failed', (item, g, reason) =>
      this.add(g.mediaId, 'import-failed', g.title, { reason }),
    )
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  add(mediaId: number, type: schema.HistoryType, title: string, data: Record<string, unknown>) {
    if (!this.ctx.library.get(mediaId)) return
    const event = this.db
      .insert(schema.events)
      .values({ mediaId, type, title, data, createdAt: Date.now() })
      .returning()
      .get()
    this.ctx.emit('history/added', event)
    return event
  }

  list(options: { mediaId?: number; limit?: number } = {}) {
    const q = this.db.select().from(schema.events)
    return (options.mediaId ? q.where(eq(schema.events.mediaId, options.mediaId)) : q)
      .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
      .limit(options.limit ?? 200)
      .all()
  }
}

export default HistoryService
