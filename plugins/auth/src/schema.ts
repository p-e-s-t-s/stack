import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('auth_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  /** `scrypt$<salt>$<hash>`, both base64. */
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable(
  'auth_sessions',
  {
    /** sha256 of the cookie token, hex. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
)

export const apiKeys = sqliteTable('auth_api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** sha256 of the key, hex. The key itself is shown once. */
  keyHash: text('key_hash').notNull().unique(),
  /** First characters of the key, to tell keys apart. */
  prefix: text('prefix').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
})

export type User = typeof users.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
