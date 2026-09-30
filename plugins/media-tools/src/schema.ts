import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export interface Paths {
  /** Executable name or path. */
  ffprobe: string
  ffmpeg: string
}

export const settings = sqliteTable('mediatools_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<Paths>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})
