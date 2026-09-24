import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const queue = sqliteTable(
  'jobs_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    /** Deduplicates pending/running jobs, e.g. `search:movie:42`. */
    dedupeKey: text('dedupe_key'),
    runAt: integer('run_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    lockUntil: integer('lock_until'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('jobs_queue_due_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_queue_dedupe_idx')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} IN ('pending', 'running')`),
  ],
)

export const schedules = sqliteTable('jobs_schedules', {
  name: text('name').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>(),
  intervalMs: integer('interval_ms').notNull(),
  nextRunAt: integer('next_run_at').notNull(),
  lastRunAt: integer('last_run_at'),
})

export type Job = typeof queue.$inferSelect
export type Schedule = typeof schedules.$inferSelect
