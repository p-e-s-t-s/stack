import { profiles } from '@magpiejs/decision/schema'
import type { Revision } from '@magpiejs/parser'
import type { ExternalIds, MediaKind } from '@magpiejs/types'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const rootFolders = sqliteTable('library_root_folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(),
  kind: text('kind', { enum: ['movie', 'series'] }).notNull(),
})

export const mediaItems = sqliteTable(
  'library_media_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').$type<MediaKind>().notNull(),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    year: integer('year'),
    overview: text('overview'),
    posterUrl: text('poster_url'),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
    externalIds: text('external_ids', { mode: 'json' }).$type<ExternalIds>().notNull(),
    primaryProvider: text('primary_provider').notNull(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    rootFolderId: integer('root_folder_id')
      .notNull()
      .references(() => rootFolders.id, { onDelete: 'restrict' }),
    /** Folder name inside the root folder. */
    folder: text('folder').notNull(),
    addedAt: integer('added_at').notNull(),
    refreshedAt: integer('refreshed_at'),
  },
  (t) => [index('library_media_items_kind_idx').on(t.kind)],
)

export const alternateTitles = sqliteTable(
  'library_alternate_titles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** `normalizeTitle(title)`, for matching releases. */
    normalized: text('normalized').notNull(),
  },
  (t) => [index('library_alternate_titles_normalized_idx').on(t.normalized)],
)

export const mediaFiles = sqliteTable('library_media_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: integer('media_id')
    .notNull()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  /** Relative to the item's folder. */
  path: text('path').notNull(),
  size: integer('size').notNull(),
  quality: text('quality').notNull(),
  formatScore: integer('format_score').notNull().default(0),
  languages: text('languages', { mode: 'json' }).$type<string[]>().notNull(),
  releaseName: text('release_name'),
  releaseGroup: text('release_group'),
  revision: text('revision', { mode: 'json' }).$type<Revision>().notNull(),
  addedAt: integer('added_at').notNull(),
})

export const settings = sqliteTable('library_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
})

export type MediaItem = typeof mediaItems.$inferSelect
export type NewMediaItem = typeof mediaItems.$inferInsert
export type MediaFile = typeof mediaFiles.$inferSelect
export type RootFolder = typeof rootFolders.$inferSelect
