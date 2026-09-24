import { mediaItems } from '@magpiejs/library/schema'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export type HistoryType = 'grabbed' | 'download-failed' | 'imported' | 'import-failed'

export const events = sqliteTable(
  'history_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    type: text('type').$type<HistoryType>().notNull(),
    /** Release name, usually. */
    title: text('title').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('history_events_media_idx').on(t.mediaId),
    index('history_events_created_idx').on(t.createdAt),
  ],
)

export type HistoryEvent = typeof events.$inferSelect
