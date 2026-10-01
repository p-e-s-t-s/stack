import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('auth_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  /** `admin`, `manager` or `viewer` (see permissions.ts). */
  role: text('role').notNull().default('admin'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  lastLoginAt: integer('last_login_at'),
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
    lastSeenAt: integer('last_seen_at'),
    /** Address and browser the session was created from, to tell sessions apart. */
    address: text('address'),
    userAgent: text('user_agent'),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
)

/** Who a user is at an identity provider (an OpenID subject, a proxy's user name). */
export const identities = sqliteTable(
  'auth_identities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    lastLoginAt: integer('last_login_at'),
  },
  (t) => [
    uniqueIndex('auth_identities_subject_idx').on(t.provider, t.subject),
    index('auth_identities_user_idx').on(t.userId),
  ],
)

export const apiKeys = sqliteTable('auth_api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** sha256 of the key, hex. The key itself is shown once. */
  keyHash: text('key_hash').notNull().unique(),
  /** First characters of the key, to tell keys apart. */
  prefix: text('prefix').notNull(),
  /** What the key may do: never more than `manager` (see permissions.ts). */
  role: text('role').notNull().default('manager'),
  /** The user who made it; the key is removed with them. */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
})

export type User = typeof users.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
