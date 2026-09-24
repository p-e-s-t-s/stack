import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const media = sqliteTable('library_media', {
  id: integer('id').primaryKey(),
  title: text('title'),
  year: integer('year').notNull().default(0),
})
