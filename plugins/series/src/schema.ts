import { mediaFiles, mediaItems } from '@magpiejs/library/schema'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export type SeriesType = 'standard' | 'daily' | 'anime'
export type SeriesStatus = 'continuing' | 'ended' | 'upcoming'
/** Which episodes to monitor when a series is added. */
export type MonitorOption = 'all' | 'future' | 'missing' | 'first' | 'latest' | 'none'

export const details = sqliteTable('series_details', {
  mediaId: integer('media_id')
    .primaryKey()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  tmdbId: integer('tmdb_id').notNull().unique(),
  tvdbId: integer('tvdb_id'),
  imdbId: text('imdb_id'),
  seriesType: text('series_type').$type<SeriesType>().notNull().default('standard'),
  status: text('status').$type<SeriesStatus>(),
  network: text('network'),
  runtimeMinutes: integer('runtime_minutes'),
  originalLanguage: text('original_language'),
  backdropUrl: text('backdrop_url'),
  genres: text('genres', { mode: 'json' }).$type<string[]>(),
  /** ISO date. */
  firstAired: text('first_aired'),
  seasonFolders: integer('season_folders', { mode: 'boolean' }).notNull().default(true),
  /** Monitor episodes that appear later (new seasons, new episodes). */
  monitorNew: integer('monitor_new', { mode: 'boolean' }).notNull().default(true),
  lastSearchedAt: integer('last_searched_at'),
})

export const seasons = sqliteTable(
  'series_seasons',
  {
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title'),
    posterUrl: text('poster_url'),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.number] })],
)

export const episodes = sqliteTable(
  'series_episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    /** Position across all regular seasons (anime). */
    absoluteNumber: integer('absolute_number'),
    title: text('title'),
    overview: text('overview'),
    /** ISO date. */
    airDate: text('air_date'),
    runtimeMinutes: integer('runtime_minutes'),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
    lastSearchedAt: integer('last_searched_at'),
  },
  (t) => [
    uniqueIndex('series_episodes_number_idx').on(t.mediaId, t.season, t.number),
    index('series_episodes_air_date_idx').on(t.airDate),
  ],
)

/** Which episodes a library file holds (several for `S01E01E02`). */
export const episodeFiles = sqliteTable(
  'series_episode_files',
  {
    fileId: integer('file_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.episodeId] }),
    uniqueIndex('series_episode_files_episode_idx').on(t.episodeId),
  ],
)

export type SeriesDetails = typeof details.$inferSelect
export type Season = typeof seasons.$inferSelect
export type Episode = typeof episodes.$inferSelect
