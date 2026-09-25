import { mediaFiles, mediaItems } from '@magpiejs/library/schema'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Which albums to monitor when an artist is added (among the types they're followed for). */
export type MonitorOption = 'all' | 'future' | 'latest' | 'none'

export const artists = sqliteTable('music_artists', {
  mediaId: integer('media_id')
    .primaryKey()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  musicbrainzId: text('musicbrainz_id').notNull().unique(),
  artistType: text('artist_type'),
  disambiguation: text('disambiguation'),
  country: text('country'),
  /** Primary types of release groups that are wanted: `Album`, `EP`, `Single`… */
  albumTypes: text('album_types', { mode: 'json' }).$type<string[]>().notNull(),
  /** Secondary types allowed on them (`Live`, `Compilation`…); none means studio releases. */
  secondaryTypes: text('secondary_types', { mode: 'json' }).$type<string[]>().notNull(),
  /** Monitor albums that appear later. */
  monitorNew: integer('monitor_new', { mode: 'boolean' }).notNull().default(true),
})

/** Release groups: albums, EPs, singles… of every type, whether wanted or not. */
export const albums = sqliteTable(
  'music_albums',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    musicbrainzId: text('musicbrainz_id').notNull(),
    title: text('title').notNull(),
    primaryType: text('primary_type'),
    secondaryTypes: text('secondary_types', { mode: 'json' }).$type<string[]>().notNull(),
    /** ISO date, or `YYYY-MM`/`YYYY`. */
    releaseDate: text('release_date'),
    coverUrl: text('cover_url'),
    monitored: integer('monitored', { mode: 'boolean' }).notNull(),
    /** The release (edition) the track list comes from; set once tracks are fetched. */
    releaseId: text('release_id'),
    lastSearchedAt: integer('last_searched_at'),
  },
  (t) => [
    uniqueIndex('music_albums_musicbrainz_idx').on(t.mediaId, t.musicbrainzId),
    index('music_albums_release_idx').on(t.releaseDate),
  ],
)

export const tracks = sqliteTable(
  'music_tracks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    albumId: integer('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    disc: integer('disc').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    lengthMs: integer('length_ms'),
    recordingId: text('recording_id'),
  },
  (t) => [uniqueIndex('music_tracks_number_idx').on(t.albumId, t.disc, t.number)],
)

/** Which track a library file is. */
export const trackFiles = sqliteTable(
  'music_track_files',
  {
    fileId: integer('file_id')
      .primaryKey()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    trackId: integer('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('music_track_files_track_idx').on(t.trackId)],
)

export type ArtistDetails = typeof artists.$inferSelect
export type Album = typeof albums.$inferSelect
export type Track = typeof tracks.$inferSelect
