import { mediaFiles, mediaItems } from '@magpiejs/library/schema'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Which episodes to download when a podcast is added. */
export type MonitorOption = 'all' | 'new' | 'latest' | 'none'

export const details = sqliteTable('podcasts_details', {
  mediaId: integer('media_id')
    .primaryKey()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  feedUrl: text('feed_url').notNull().unique(),
  itunesId: text('itunes_id'),
  author: text('author'),
  link: text('link'),
  language: text('language'),
  /** Download episodes that appear in the feed later. */
  monitorNew: integer('monitor_new', { mode: 'boolean' }).notNull().default(true),
  /** Keep only the files of the newest N episodes; null keeps everything. */
  keepLatest: integer('keep_latest'),
  /** For conditional feed requests. */
  etag: text('etag'),
  lastModified: text('last_modified'),
  refreshedAt: integer('refreshed_at'),
  refreshError: text('refresh_error'),
})

export const episodes = sqliteTable(
  'podcasts_episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    guid: text('guid').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** ISO date-time. */
    publishedAt: text('published_at'),
    enclosureUrl: text('enclosure_url').notNull(),
    enclosureType: text('enclosure_type'),
    enclosureSize: integer('enclosure_size'),
    durationSeconds: integer('duration_seconds'),
    season: integer('season'),
    number: integer('number'),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
    /** Failed downloads so far; after a few, the episode waits for a manual download. */
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('podcasts_episodes_guid_idx').on(t.mediaId, t.guid),
    index('podcasts_episodes_published_idx').on(t.publishedAt),
  ],
)

export const episodeFiles = sqliteTable(
  'podcasts_episode_files',
  {
    fileId: integer('file_id')
      .primaryKey()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('podcasts_episode_files_episode_idx').on(t.episodeId)],
)

export type PodcastDetails = typeof details.$inferSelect
export type Episode = typeof episodes.$inferSelect
