import { users } from '@magpiejs/auth/schema'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** A user's password. Users who sign in another way have none. */
export const credentials = sqliteTable('authlocal_credentials', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** `scrypt$<salt>$<hash>`, both base64. */
  passwordHash: text('password_hash').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
