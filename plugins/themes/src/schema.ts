import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Instance-wide values; today only `default`, the theme for users who have not chosen. */
export const settings = sqliteTable('themes_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** One row per user who chose a theme; no row means "follow the instance default". */
export const preferences = sqliteTable('themes_preferences', {
  userId: integer('user_id').primaryKey(),
  themeId: text('theme_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
