import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export interface Settings {
  enabled: boolean
  /** Hours between backups. */
  intervalHours: number
  /** Backups to keep; the oldest are deleted. */
  retention: number
  /** Also keep magpie.yml, which holds API keys and passwords in plain text. */
  includeConfig: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  intervalHours: 24,
  retention: 7,
  includeConfig: true,
}

export const settings = sqliteTable('backup_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<Settings>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})
