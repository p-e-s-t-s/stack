import { mediaItems } from '@magpiejs/library/schema'
import type { Protocol, ReleaseInfo } from '@magpiejs/types'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export type GrabState =
  | 'grabbed' // sent to the client, not seen in its list yet
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'stalled'
  | 'import_pending' // finished downloading; waiting for the import plugin
  | 'importing'
  | 'imported'
  | 'failed'
  | 'import_failed'
  | 'removed'

export const ACTIVE_STATES: GrabState[] = [
  'grabbed',
  'queued',
  'downloading',
  'paused',
  'stalled',
  'import_pending',
  'importing',
]

export const grabs = sqliteTable(
  'downloads_grabs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    release: text('release', { mode: 'json' }).$type<ReleaseInfo>().notNull(),
    title: text('title').notNull(),
    quality: text('quality').notNull(),
    formatScore: integer('format_score').notNull().default(0),
    protocol: text('protocol').$type<Protocol>().notNull(),
    clientId: text('client_id').notNull(),
    /** Torrent info hash (lower case) or usenet job id. */
    downloadId: text('download_id').notNull(),
    state: text('state').$type<GrabState>().notNull(),
    progress: real('progress').notNull().default(0),
    sizeBytes: integer('size_bytes'),
    etaSeconds: integer('eta_seconds'),
    /** Where the client put the finished download (as the client reports it). */
    outputPath: text('output_path'),
    error: text('error'),
    manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
    grabbedAt: integer('grabbed_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastProgressAt: integer('last_progress_at').notNull(),
  },
  (t) => [
    index('downloads_grabs_state_idx').on(t.state),
    index('downloads_grabs_media_idx').on(t.mediaId),
  ],
)

export const blocklist = sqliteTable(
  'downloads_blocklist',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    infoHash: text('info_hash'),
    indexerId: text('indexer_id'),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('downloads_blocklist_media_idx').on(t.mediaId)],
)

/**
 * The parts of a library item a download covers (episodes, books, albums…), by the kind
 * plugin's own ids. Empty for items without parts (movies).
 */
export const grabUnits = sqliteTable(
  'downloads_grab_units',
  {
    grabId: integer('grab_id')
      .notNull()
      .references(() => grabs.id, { onDelete: 'cascade' }),
    unitId: integer('unit_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.grabId, t.unitId] })],
)

export type Grab = typeof grabs.$inferSelect
export type BlocklistEntry = typeof blocklist.$inferSelect
