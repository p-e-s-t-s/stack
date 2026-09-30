import type { ProbeFacts } from '@magpiejs/probe'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export type Severity = 'warn' | 'reject'
/** What a check does when it finds something: nothing, a warning, or a rejection. */
export type Mode = 'off' | 'warn' | 'reject'

export interface Finding {
  severity: Severity
  reason: string
  detail?: unknown
}

export type Outcome = 'passed' | 'warned' | 'rejected'

export interface Policy {
  /** Per check; a check that is not listed uses its own default. */
  modes: Record<string, Mode>
  /** Allowed difference between the file's runtime and the metadata's, as a fraction. */
  durationTolerance: number
}

export const DEFAULT_POLICY: Policy = { modes: {}, durationTolerance: 0.1 }

export const settings = sqliteTable('verify_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<Policy>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * One row per checked download, kept with the facts ffprobe gave so queue pages can show
 * what is really in the download next to the release name. Not tied to `downloads_grabs` by
 * a foreign key: a rejected grab is removed, and its findings are the point of the record.
 */
export const results = sqliteTable('verify_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  grabId: integer('grab_id').notNull(),
  title: text('title').notNull(),
  /** The checked files with their facts, when probed. */
  files: text('files', { mode: 'json' })
    .$type<{ path: string; size: number; facts: ProbeFacts | null }[]>()
    .notNull(),
  findings: text('findings', { mode: 'json' }).$type<Finding[]>().notNull(),
  outcome: text('outcome').$type<Outcome>().notNull(),
  createdAt: integer('created_at').notNull(),
})

export type Result = typeof results.$inferSelect
