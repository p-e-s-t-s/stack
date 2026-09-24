// Per-plugin migration runner (docs/PLAN.md §4.2).
//
// Migrations are drizzle-kit output: `meta/_journal.json` plus one `<tag>.sql` file per
// entry, statements separated by `--> statement-breakpoint`. Everything here is
// synchronous (better-sqlite3), so migrations from different plugins can never interleave.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type BetterSqlite3 from 'better-sqlite3'
import { checkOwnership, NAMESPACE_PATTERN } from './ownership'

export const MIGRATIONS_TABLE = '_magpie_migrations'

export interface Migration {
  tag: string
  hash: string
  statements: string[]
}

/** A TypeScript data step that runs right after the SQL of the migration with the same tag. */
export type MigrationStep = (db: BetterSqlite3.Database) => void

export class MigrationError extends Error {
  constructor(
    public code: 'drift' | 'downgrade' | 'order' | 'ownership' | 'foreign-key' | 'failed',
    public namespace: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${namespace}] ${message}`, options)
    this.name = 'MigrationError'
  }
}

interface Journal {
  entries: { idx: number; tag: string }[]
}

export function readMigrations(folder: string | URL): Migration[] {
  const dir = typeof folder === 'string' ? folder : fileURLToPath(folder)
  let journal: Journal
  try {
    journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'))
  } catch (cause) {
    throw new Error(`cannot read migration journal in ${dir}`, { cause })
  }
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const content = readFileSync(join(dir, `${tag}.sql`), 'utf8')
      return {
        tag,
        hash: createHash('sha256').update(content).digest('hex'),
        statements: splitStatements(content),
      }
    })
}

export function splitStatements(content: string) {
  return (
    content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
      // the runner manages foreign key enforcement itself
      .filter((s) => !/^PRAGMA\s+foreign_keys\s*=\s*\w+\s*;?$/i.test(s))
  )
}

export function ensureMigrationsTable(db: BetterSqlite3.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    tag TEXT NOT NULL,
    hash TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    UNIQUE (namespace, tag)
  )`)
}

export interface AppliedMigration {
  tag: string
  hash: string
  applied_at: string
}

export function getApplied(db: BetterSqlite3.Database, namespace: string): AppliedMigration[] {
  return db
    .prepare(
      `SELECT tag, hash, applied_at FROM ${MIGRATIONS_TABLE} WHERE namespace = ? ORDER BY id`,
    )
    .all(namespace) as AppliedMigration[]
}

/** Returns the pending migrations, or throws if the recorded history doesn't match. */
export function planMigrations(
  namespace: string,
  migrations: Migration[],
  applied: AppliedMigration[],
) {
  applied.forEach((row, index) => {
    const migration = migrations[index]
    if (!migration || migration.tag !== row.tag) {
      const known = migrations.some((m) => m.tag === row.tag)
      if (!known) {
        throw new MigrationError(
          'downgrade',
          namespace,
          `database has migration ${row.tag}, which this version of the plugin doesn't know. ` +
            `The plugin is older than its data; upgrade it or restore a backup.`,
        )
      }
      throw new MigrationError('order', namespace, `migration ${row.tag} was applied out of order`)
    }
    if (migration.hash !== row.hash) {
      throw new MigrationError(
        'drift',
        namespace,
        `migration ${row.tag} changed after it was applied (hash mismatch). ` +
          `Released migrations must not be edited; add a new one instead.`,
      )
    }
  })
  return migrations.slice(applied.length)
}

export interface RunOptions {
  namespace: string
  migrations: Migration[]
  steps?: Record<string, MigrationStep>
  /** Called once, before anything is applied, when there are pending migrations. */
  beforeApply?: (pending: Migration[]) => void
  now?: () => Date
}

/**
 * Applies all pending migrations of one namespace in a single transaction, with foreign
 * key enforcement off and `PRAGMA foreign_key_check` before commit. Returns the applied tags.
 */
export function runMigrations(db: BetterSqlite3.Database, options: RunOptions): string[] {
  const { namespace, migrations, steps = {}, now = () => new Date() } = options
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(`invalid namespace "${namespace}": use lowercase letters and digits`)
  }
  for (const tag of Object.keys(steps)) {
    if (!migrations.some((m) => m.tag === tag)) {
      throw new Error(`[${namespace}] data step for unknown migration ${tag}`)
    }
  }

  ensureMigrationsTable(db)
  const pending = planMigrations(namespace, migrations, getApplied(db, namespace))
  if (!pending.length) return []

  for (const migration of pending) {
    const violations = checkOwnership(migration.statements, namespace)
    if (violations.length) {
      const names = [...new Set(violations.map((v) => v.name))].join(', ')
      throw new MigrationError(
        'ownership',
        namespace,
        `migration ${migration.tag} changes objects it doesn't own: ${names}`,
      )
    }
  }

  options.beforeApply?.(pending)

  const insert = db.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (namespace, tag, hash, applied_at) VALUES (?, ?, ?, ?)`,
  )
  const apply = db.transaction(() => {
    for (const migration of pending) {
      for (const statement of migration.statements) db.exec(statement)
      steps[migration.tag]?.(db)
      insert.run(namespace, migration.tag, migration.hash, now().toISOString())
    }
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length) {
      throw new MigrationError(
        'foreign-key',
        namespace,
        `migration leaves ${violations.length} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`,
      )
    }
  })

  // must be set outside a transaction to take effect
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
  db.pragma('foreign_keys = OFF')
  try {
    apply()
  } catch (error) {
    if (error instanceof MigrationError) throw error
    throw new MigrationError(
      'failed',
      namespace,
      `migration failed and was rolled back: ${error}`,
      {
        cause: error,
      },
    )
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }
  return pending.map((m) => m.tag)
}
