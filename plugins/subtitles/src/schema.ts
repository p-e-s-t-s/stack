import { mediaFiles, mediaItems } from '@magpiejs/library/schema'
import type { SubtitleRequirement } from '@magpiejs/types'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export interface ProfilePolicy {
  automatic: boolean
  monitoredOnly: boolean
  upgrades: boolean
  upgradeDays: number
  upgradeDelta: number
  sync: 'off' | 'best-effort' | 'required'
}

export const profiles = sqliteTable('subtitles_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  revision: integer('revision').notNull().default(1),
  requirements: text('requirements', { mode: 'json' }).$type<SubtitleRequirement[]>().notNull(),
  policy: text('policy', { mode: 'json' }).$type<ProfilePolicy>().notNull(),
})
export const assignments = sqliteTable('subtitles_assignments', {
  mediaId: integer('media_id').primaryKey().references(() => mediaItems.id, { onDelete: 'cascade' }),
  // A row with null explicitly disables subtitles; no row inherits the kind default.
  profileId: integer('profile_id').references(() => profiles.id, { onDelete: 'restrict' }),
})
export const defaults = sqliteTable('subtitles_defaults', {
  kind: text('kind').primaryKey().$type<'movie' | 'series'>(),
  profileId: integer('profile_id').references(() => profiles.id, { onDelete: 'restrict' }),
})
export const settings = sqliteTable('subtitles_settings', {
  key: text('key').primaryKey(),
  value: text('value', {mode:'json'}).$type<{ffprobe:string; syncEngine:'ffsubsync'|'alass'; syncBinary:string}>().notNull(),
})
export interface ProbeFacts {
  duration?: number
  streams: { index: number; codec: string; language: string | null; forced: boolean | null; hi: boolean | null }[]
}
export const probes = sqliteTable('subtitles_probes', {
  fileId: integer('file_id').primaryKey().references(() => mediaFiles.id, { onDelete: 'cascade' }),
  generation: text('generation').notNull(),
  facts: text('facts', { mode: 'json' }).$type<ProbeFacts>(),
  error: text('error'),
  scannedAt: integer('scanned_at').notNull(),
})
export const inventory = sqliteTable('subtitles_inventory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fileId: integer('file_id').notNull().references(() => mediaFiles.id, { onDelete: 'cascade' }),
  generation: text('generation').notNull(),
  // stream:<index> or a path relative to the item's directory.
  location: text('location').notNull(),
  embedded: integer('embedded', { mode: 'boolean' }).notNull(),
  format: text('format').notNull(),
  language: text('language'),
  forced: integer('forced', { mode: 'boolean' }),
  hi: integer('hi', { mode: 'boolean' }),
  hash: text('hash'),
  managed: integer('managed', { mode: 'boolean' }).notNull().default(false),
  protected: integer('protected', { mode: 'boolean' }).notNull().default(false),
  present: integer('present', { mode: 'boolean' }).notNull().default(true),
  valid: integer('valid', { mode: 'boolean' }).notNull().default(true),
  error: text('error'),
  providerId: text('provider_id'),
  candidateId: text('candidate_id'),
  score: integer('score'),
  evidence: text('evidence', { mode: 'json' }).$type<string[]>(),
  acquiredAt: integer('acquired_at'),
  sync: text('sync').$type<'off' | 'succeeded' | 'failed' | 'skipped'>().notNull().default('off'),
  syncError: text('sync_error'),
}, t => [uniqueIndex('subtitles_inventory_location_idx').on(t.fileId, t.location), index('subtitles_inventory_file_idx').on(t.fileId)])
export type Inventory = typeof inventory.$inferSelect
export type Profile = typeof profiles.$inferSelect
export type WantedState = 'disabled' | 'unknown' | 'missing' | 'satisfied' | 'upgradeable' | 'waiting' | 'blocked'
export const wanted = sqliteTable('subtitles_wanted', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fileId: integer('file_id').notNull().references(() => mediaFiles.id, { onDelete: 'cascade' }),
  requirementId: text('requirement_id').notNull(),
  profileId: integer('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  generation: text('generation').notNull(),
  state: text('state').$type<WantedState>().notNull(),
  reason: text('reason').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextSearchAt: integer('next_search_at').notNull().default(0),
}, t => [uniqueIndex('subtitles_wanted_requirement_idx').on(t.fileId, t.requirementId), index('subtitles_wanted_due_idx').on(t.nextSearchAt)])
export const providerState = sqliteTable('subtitles_provider_state', {
  id: text('id').primaryKey(),
  error: text('error'),
  code: text('code'),
  retryAt: integer('retry_at'),
  remaining: integer('remaining'),
  resetAt: integer('reset_at'),
})
export interface InstallRecord {
  fileId: number
  generation: string
  location: string
  format: string
  language: string | null
  forced: boolean | null
  hi: boolean | null
  providerId: string | null
  candidateId: string | null
  score: number | null
  evidence: string[]
  acquiredAt: number
  sync: Inventory['sync']
  syncError: string | null
}
// Intentionally no cascading file FK: an interrupted operation must remain recoverable.
export const operations = sqliteTable('subtitles_operations', {
  id: text('id').primaryKey(),
  fileId: integer('file_id').notNull(),
  root: text('root').notNull(),
  target: text('target').notNull(),
  staged: text('staged').notNull(),
  backup: text('backup').notNull(),
  oldHash: text('old_hash'),
  newHash: text('new_hash').notNull(),
  record: text('record', { mode: 'json' }).$type<InstallRecord>().notNull(),
  state: text('state').$type<'prepared' | 'done' | 'rolled-back' | 'blocked'>().notNull(),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
})
export const blocklist = sqliteTable('subtitles_blocklist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fileId: integer('file_id').notNull().references(() => mediaFiles.id, { onDelete: 'cascade' }),
  generation: text('generation').notNull(),
  candidateId: text('candidate_id').notNull(),
}, t => [uniqueIndex('subtitles_blocklist_candidate_idx').on(t.fileId, t.generation, t.candidateId)])
