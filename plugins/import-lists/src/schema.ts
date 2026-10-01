import { mediaItems } from '@magpiejs/library/schema'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** What the last sync of each list did. The list itself is a loader entry, not a row. */
export const status = sqliteTable('importlists_status', {
  listId: text('list_id').primaryKey(),
  lastSyncedAt: integer('last_synced_at'),
  lastError: text('last_error'),
  added: integer('added').notNull().default(0),
  existing: integer('existing').notNull().default(0),
  excluded: integer('excluded').notNull().default(0),
  unmatched: integer('unmatched').notNull().default(0),
  failed: integer('failed').notNull().default(0),
})

/**
 * Titles a list added, and titles it could not match. `key` is `<kind>:tmdb:<id>` for
 * resolved titles and `<kind>:title:<name> <year>` for unmatched ones.
 */
export const seen = sqliteTable(
  'importlists_seen',
  {
    listId: text('list_id').notNull(),
    key: text('key').notNull(),
    kind: text('kind', { enum: ['movie', 'series'] }).notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    status: text('status', { enum: ['added', 'unmatched'] }).notNull(),
    mediaId: integer('media_id').references(() => mediaItems.id, { onDelete: 'set null' }),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.key] })],
)

/** Titles no list adds again: ones the user deleted, or excluded by hand. */
export const exclusions = sqliteTable('importlists_exclusions', {
  key: text('key').primaryKey(),
  kind: text('kind', { enum: ['movie', 'series'] }).notNull(),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type ListStatus = typeof status.$inferSelect
export type SeenRow = typeof seen.$inferSelect
export type Exclusion = typeof exclusions.$inferSelect
