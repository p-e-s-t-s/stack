import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { media } from '../library/schema'

export const assignments = sqliteTable('subtitles_assignments', {
  mediaId: integer('media_id')
    .primaryKey()
    .references(() => media.id, { onDelete: 'cascade' }),
  profile: text('profile').notNull(),
})
