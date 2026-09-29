import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ReviewSession } from './review'

export const sessions = sqliteTable('import_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  data: text('data', { mode: 'json' }).$type<ReviewSession>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})
