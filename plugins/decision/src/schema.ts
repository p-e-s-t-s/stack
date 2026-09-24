import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One entry of a profile's ordered quality list: a quality or a group of equal ones. */
export type ProfileItem =
  { quality: string; allowed: boolean } | { name: string; qualities: string[]; allowed: boolean }

export const qualitySizes = sqliteTable('decision_quality_sizes', {
  quality: text('quality').primaryKey(),
  /** MB per minute of runtime, or MB in total, per the quality's family. */
  min: integer('min').notNull().default(0),
  preferred: integer('preferred'),
  max: integer('max'),
})

export const profiles = sqliteTable('decision_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  /** The quality family this profile's items come from (`video`, `audio`…). */
  family: text('family').notNull().default('video'),
  /** Worst to best. */
  items: text('items', { mode: 'json' }).$type<ProfileItem[]>().notNull(),
  /** A quality, or a group name from `items`. */
  cutoff: text('cutoff').notNull(),
  minFormatScore: integer('min_format_score').notNull().default(0),
  cutoffFormatScore: integer('cutoff_format_score').notNull().default(0),
  upgradesAllowed: integer('upgrades_allowed', { mode: 'boolean' }).notNull().default(true),
  /** ISO 639-1 codes; empty means any language. */
  languages: text('languages', { mode: 'json' }).$type<string[]>().notNull(),
  minSeeders: integer('min_seeders').notNull().default(1),
  minAgeMinutes: integer('min_age_minutes').notNull().default(0),
})

/** Conditions every family understands; families add their own (`resolution`, `bitrate`…). */
export type GenericCondition = 'title' | 'group' | 'language' | 'size' | 'indexerFlag'
export type ConditionType = GenericCondition | (string & {})

export interface Condition {
  type: ConditionType
  /** Regex for title/group/edition; a value for the others; `{ min, max }` GB for size. */
  value: string | { min?: number; max?: number }
  negate?: boolean
  required?: boolean
}

export const customFormats = sqliteTable('decision_custom_formats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  conditions: text('conditions', { mode: 'json' }).$type<Condition[]>().notNull(),
  includeInFileName: integer('include_in_file_name', { mode: 'boolean' }).notNull().default(false),
})

export const profileScores = sqliteTable(
  'decision_profile_scores',
  {
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    formatId: integer('format_id')
      .notNull()
      .references(() => customFormats.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.formatId] })],
)

export const restrictions = sqliteTable('decision_restrictions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Plain words or `/regex/`; a release must contain at least one. */
  required: text('required', { mode: 'json' }).$type<string[]>().notNull(),
  /** A release must contain none. */
  ignored: text('ignored', { mode: 'json' }).$type<string[]>().notNull(),
})

export type Profile = typeof profiles.$inferSelect
export type CustomFormat = typeof customFormats.$inferSelect
export type Restriction = typeof restrictions.$inferSelect
export type QualitySize = typeof qualitySizes.$inferSelect
