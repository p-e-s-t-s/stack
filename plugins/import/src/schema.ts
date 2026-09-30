import { type MediaFile, mediaItems } from '@magpiejs/library/schema'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ReviewSession } from './review'

export const sessions = sqliteTable('import_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  data: text('data', { mode: 'json' }).$type<ReviewSession>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type OperationType = 'place' | 'replace' | 'rename' | 'delete'
export type OperationMethod = 'hardlink' | 'copy' | 'move'
export type OperationStatus =
  /** Journaled, the file change has not been confirmed (a crash leaves it here). */
  | 'pending'
  | 'applied'
  | 'undone'
  | 'undo_failed'
  /** Too old, or its parked file was purged: can no longer be undone. */
  | 'expired'
  /** The change never happened (a crash or an error before it finished). */
  | 'abandoned'

/** What an operation removed from the library's records, so undo can put it back. */
export interface OperationSnapshot {
  /** The library file record the operation replaced or removed. */
  file?: Omit<MediaFile, 'id' | 'addedAt'>
  /** Kind-specific state (series: the episodes the file covered). */
  extra?: unknown
  /** What the importer noted about the import as a whole (series: links it took over). */
  note?: unknown
}

export const operations = sqliteTable(
  'import_operations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** One batch per import job, review commit or bulk action. */
    batchId: text('batch_id').notNull(),
    /** Set on sidecar and replaced-file operations: the operation they belong to. */
    parentId: integer('parent_id'),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    targetId: integer('target_id'),
    type: text('type').$type<OperationType>().notNull(),
    /** Where the file came from; null for deletes. */
    source: text('source'),
    /** The library path the operation created, replaced, renamed to or removed (absolute). */
    dest: text('dest').notNull(),
    method: text('method').$type<OperationMethod>(),
    /** Where a replaced or deleted file was parked. */
    trashPath: text('trash_path'),
    trashSize: integer('trash_size'),
    /** Size, mtime and a short hash of `dest` right after the operation. */
    fingerprint: text('fingerprint'),
    snapshot: text('snapshot', { mode: 'json' }).$type<OperationSnapshot>(),
    status: text('status').$type<OperationStatus>().notNull(),
    /** Why an undo failed, or what recovery did. */
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    undoneAt: integer('undone_at'),
  },
  (t) => [
    index('import_operations_batch_idx').on(t.batchId),
    index('import_operations_media_idx').on(t.mediaId),
    index('import_operations_parent_idx').on(t.parentId),
  ],
)

export type Operation = typeof operations.$inferSelect
