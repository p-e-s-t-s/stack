import { mediaItems } from '@magpiejs/library/schema'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export type MinimumAvailability = 'announced' | 'inCinemas' | 'released'

export const details = sqliteTable('movies_details', {
  mediaId: integer('media_id')
    .primaryKey()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  tmdbId: integer('tmdb_id').notNull().unique(),
  imdbId: text('imdb_id'),
  runtimeMinutes: integer('runtime_minutes'),
  originalLanguage: text('original_language'),
  /** ISO dates. */
  inCinemas: text('in_cinemas'),
  digitalRelease: text('digital_release'),
  physicalRelease: text('physical_release'),
  minimumAvailability: text('minimum_availability')
    .$type<MinimumAvailability>()
    .notNull()
    .default('released'),
  backdropUrl: text('backdrop_url'),
  genres: text('genres', { mode: 'json' }).$type<string[]>(),
  lastSearchedAt: integer('last_searched_at'),
})

export type MovieDetails = typeof details.$inferSelect
