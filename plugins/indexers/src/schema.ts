import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Runtime state per indexer instance; the indexer's settings live in magpie.yml. */
export const status = sqliteTable('indexers_status', {
  indexerId: text('indexer_id').primaryKey(),
  failures: integer('failures').notNull().default(0),
  disabledUntil: integer('disabled_until'),
  lastError: text('last_error'),
  lastSuccessAt: integer('last_success_at'),
  lastRssAt: integer('last_rss_at'),
  /** Newest release seen by RSS sync, to stop paging there next time. */
  lastRssGuid: text('last_rss_guid'),
})

export type IndexerStatus = typeof status.$inferSelect
