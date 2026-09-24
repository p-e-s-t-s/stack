// @magpiejs/database: plugin-owned SQLite schemas with versioned migrations
// (docs/PLAN.md §3.0.1, §4.2).

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import BetterSqlite3 from 'better-sqlite3'
import { type Context, Service } from 'cordis'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import z from 'schemastery'
import { NAMESPACE_PATTERN } from './ownership'
import {
  getApplied,
  type Migration,
  MIGRATIONS_TABLE,
  type MigrationStep,
  readMigrations,
  runMigrations,
} from './runner'

export * from './ownership'
export * from './runner'

declare module 'cordis' {
  interface Context {
    database: DatabaseService
  }
}

export interface RegisterOptions<S extends Record<string, unknown>> {
  /** Table prefix owned by the plugin: `subtitles` owns `subtitles_*`. */
  namespace: string
  /** Drizzle table objects (and relations) of this plugin. */
  schema: S
  /** Folder with drizzle-kit output, usually `new URL('../migrations', import.meta.url)`. */
  migrations: string | URL | Migration[]
  /** Optional TypeScript data steps, keyed by migration tag. */
  steps?: Record<string, MigrationStep>
}

export interface NamespaceStatus {
  namespace: string
  active: number
  applied: { tag: string; applied_at: string }[]
}

export interface DatabaseConfig {
  path: string
  backupDir: string
  backupRetention: number
  busyTimeout: number
}

export const DatabaseConfig: z<Partial<DatabaseConfig>, DatabaseConfig> = z.object({
  path: z
    .string()
    .default('data/magpie.db')
    .description('SQLite file, relative to the config directory.'),
  backupDir: z
    .string()
    .default('backups')
    .description('Backup folder, relative to the database file.'),
  backupRetention: z.natural().default(20).description('Number of backups to keep.'),
  busyTimeout: z.natural().default(5000).description('Milliseconds to wait on a locked database.'),
})

export class DatabaseService extends Service {
  static Config = DatabaseConfig

  sqlite!: BetterSqlite3.Database
  config: DatabaseConfig
  private filename!: string
  private active = new Map<string, number>()

  constructor(ctx: Context, config: Partial<DatabaseConfig> = {}) {
    super(ctx, 'database')
    this.config = DatabaseConfig(config)
  }

  async *[Service.init]() {
    const base = this.ctx.root.baseUrl ? fileURLToPath(this.ctx.root.baseUrl) : process.cwd()
    this.filename = this.config.path === ':memory:' ? ':memory:' : resolve(base, this.config.path)
    if (this.filename !== ':memory:') mkdirSync(dirname(this.filename), { recursive: true })

    this.sqlite = new BetterSqlite3(this.filename)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('synchronous = NORMAL')
    this.sqlite.pragma(`busy_timeout = ${this.config.busyTimeout}`)
    this.sqlite.pragma('foreign_keys = ON')
    this.assertNoInterruptedRebuild()
    this.ctx.logger.info('opened %C', this.filename)
    yield () => this.sqlite.close()
  }

  get backupDir() {
    return this.filename === ':memory:'
      ? undefined
      : resolve(dirname(this.filename), this.config.backupDir)
  }

  /**
   * Registers the calling plugin's schema, applies its pending migrations and returns a
   * typed Drizzle instance. Runs inside the caller's lifecycle: disposing the plugin
   * unregisters the schema (its tables and data stay).
   */
  register<S extends Record<string, unknown>>(
    options: RegisterOptions<S>,
  ): BetterSQLite3Database<S> {
    const caller = this.ctx
    const { namespace, schema, steps } = options
    if (!NAMESPACE_PATTERN.test(namespace)) {
      throw new Error(`invalid namespace "${namespace}": use lowercase letters and digits`)
    }
    for (const value of Object.values(schema)) {
      const table = getTableName(value)
      if (table && !table.startsWith(namespace + '_')) {
        throw new Error(`[${namespace}] schema declares table ${table}, which it doesn't own`)
      }
    }
    const migrations = Array.isArray(options.migrations)
      ? options.migrations
      : readMigrations(options.migrations)

    const applied = runMigrations(this.sqlite, {
      namespace,
      migrations,
      steps,
      beforeApply: (pending) => {
        this.backup(`${namespace}-${pending.at(-1)!.tag}`)
      },
    })
    if (applied.length)
      caller.logger.info('applied %d migration(s): %s', applied.length, applied.join(', '))

    caller.effect(() => {
      this.active.set(namespace, (this.active.get(namespace) ?? 0) + 1)
      return () => {
        const count = (this.active.get(namespace) ?? 1) - 1
        if (count) this.active.set(namespace, count)
        else this.active.delete(namespace)
      }
    }, `database.register(${namespace})`)

    return drizzle(this.sqlite, { schema })
  }

  /** Snapshot of the whole database via `VACUUM INTO`. Returns the file path. */
  backup(reason = 'manual') {
    const dir = this.backupDir
    if (!dir) return
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `magpie-${stamp}-${reason.replace(/[^\w-]/g, '_')}.db`)
    this.sqlite.prepare('VACUUM INTO ?').run(file)
    this.ctx.logger.info('backup written to %C', file)
    this.pruneBackups()
    return file
  }

  status(): NamespaceStatus[] {
    const rows = this.sqlite
      .prepare(`SELECT DISTINCT namespace FROM ${MIGRATIONS_TABLE} ORDER BY namespace`)
      .all() as { namespace: string }[]
    return rows.map(({ namespace }) => ({
      namespace,
      active: this.active.get(namespace) ?? 0,
      applied: getApplied(this.sqlite, namespace).map(({ tag, applied_at }) => ({
        tag,
        applied_at,
      })),
    }))
  }

  /**
   * Drops every table, index and view of a namespace and forgets its migrations, after a
   * backup. Only for an explicit "Delete data" action; refuses while the plugin is loaded.
   */
  dropNamespace(namespace: string) {
    if (!NAMESPACE_PATTERN.test(namespace)) throw new Error(`invalid namespace "${namespace}"`)
    if (this.active.get(namespace)) {
      throw new Error(`[${namespace}] is in use; disable the plugin before deleting its data`)
    }
    const objects = this.sqlite
      .prepare(
        `SELECT type, name FROM sqlite_master
         WHERE type IN ('table', 'view') AND name LIKE ? ESCAPE '\\'`,
      )
      .all(`${namespace}\\_%`) as { type: string; name: string }[]
    this.backup(`drop-${namespace}`)
    this.sqlite.pragma('foreign_keys = OFF')
    try {
      this.sqlite.transaction(() => {
        for (const { type, name } of objects) {
          this.sqlite.exec(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS "${name}"`)
        }
        this.sqlite.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE namespace = ?`).run(namespace)
      })()
    } finally {
      this.sqlite.pragma('foreign_keys = ON')
    }
    return objects.map((o) => o.name)
  }

  private pruneBackups() {
    const dir = this.backupDir
    if (!dir || !existsSync(dir)) return
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('magpie-') && f.endsWith('.db'))
      .sort()
    for (const file of files.slice(0, Math.max(0, files.length - this.config.backupRetention))) {
      rmSync(join(dir, file), { force: true })
    }
  }

  /** drizzle-kit rebuilds run in one transaction, so a leftover `__new_*` table means tampering or a bug. */
  private assertNoInterruptedRebuild() {
    const leftovers = this.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_\\_new\\_%' ESCAPE '\\'`,
      )
      .all() as { name: string }[]
    if (leftovers.length) {
      throw new Error(
        `found leftover rebuild tables (${leftovers.map((r) => r.name).join(', ')}); ` +
          `restore from ${this.backupDir ?? 'a backup'} or inspect the database before starting`,
      )
    }
  }
}

function getTableName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return
  const name = (value as Record<symbol, unknown>)[Symbol.for('drizzle:Name')]
  return typeof name === 'string' ? name : undefined
}

export default DatabaseService
export type { BetterSQLite3Database as Drizzle }
