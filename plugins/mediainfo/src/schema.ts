import type { ProbeFacts } from '@magpiejs/probe'
import { mediaFiles } from '@magpiejs/library/schema'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const files = sqliteTable('mediainfo_files', {
  fileId: integer('file_id')
    .primaryKey()
    .references(() => mediaFiles.id, { onDelete: 'cascade' }),
  /** `fingerprint(path)` when probed; a different value on disk means the facts are stale. */
  fingerprint: text('fingerprint').notNull(),
  facts: text('facts', { mode: 'json' }).$type<ProbeFacts>(),
  /** Why the file could not be probed (corrupt, unreadable). Null when `facts` is set. */
  error: text('error'),
  probedAt: integer('probed_at').notNull(),
})

export type FileInfo = typeof files.$inferSelect
