import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One attempt-tracked send of one event to one destination, for the activity list. */
export const log = sqliteTable('notifications_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** `media.imported`, `download.failed`, … or `test`. */
  event: text('event').notNull(),
  title: text('title').notNull(),
  /** The destination's instance id and the name it showed when the event happened. */
  notifierId: text('notifier_id').notNull(),
  notifierName: text('notifier_name').notNull(),
  status: text('status', { enum: ['queued', 'retrying', 'sent', 'failed', 'cancelled'] })
    .notNull()
    .default('queued'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type LogEntry = typeof log.$inferSelect
