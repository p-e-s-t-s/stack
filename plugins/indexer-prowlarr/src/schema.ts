import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Indexers Prowlarr pushed to Magpie as a Radarr/Sonarr application, as it sent them. */
export const pushed = sqliteTable('prowlarr_pushed', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** The v3 indexer resource (JSON), returned unchanged so Prowlarr sees no difference. */
  body: text('body').notNull(),
})

export const tags = sqliteTable('prowlarr_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull().unique(),
})
