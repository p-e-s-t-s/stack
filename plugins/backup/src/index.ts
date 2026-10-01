// @magpiejs/backup: scheduled backups of the database and magpie.yml, kept as zip files
// next to the automatic pre-migration snapshots, and restoring them from the console.
//
// A backup is `magpie-backup-<time>-<reason>.zip` holding `magpie.db` (a consistent
// snapshot taken while Magpie runs), `magpie.yml` and a small `manifest.json`. A restore is
// staged and completes on the next start, because a running database cannot be replaced
// (see @magpiejs/database `restore.ts`).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type {} from '@magpiejs/api'
import { ApiError } from '@magpiejs/api'
import {
  type Drizzle,
  MIGRATIONS_TABLE,
  RESTORE_DIR,
  STAGED_CONFIG,
  STAGED_DB,
} from '@magpiejs/database'
import type {} from '@magpiejs/health'
import type {} from '@magpiejs/jobs'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'
import { readZip, writeZip } from './zip'

export * from './schema'

declare module 'cordis' {
  interface Context {
    backup: BackupService
  }
  interface Events {
    /** A backup was made, deleted or staged for restore, or the settings changed. */
    'backup/changed'(): void
  }
}

export type Reason = 'scheduled' | 'manual'

export interface BackupFile {
  name: string
  size: number
  createdAt: number
  reason: Reason
}

export interface Staged {
  /** The backup the staged restore comes from. */
  from: string
  config: boolean
}

const KEY = 'settings'
const NAME = /^magpie-backup-[\w-]+\.zip$/
const HOUR = 3_600_000

export class BackupService extends Service {
  static inject = ['database', 'jobs']

  db!: Drizzle<typeof schema>
  now = () => Date.now()
  /** The last failed attempt, cleared by the next success. Not kept across restarts. */
  lastError: { at: number; message: string } | null = null
  private settings_: schema.Settings = schema.DEFAULT_SETTINGS
  private unschedule?: () => void
  private busy = false

  constructor(ctx: Context) {
    super(ctx, 'backup')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'backup',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    const saved = this.db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
    this.settings_ = normalize(saved?.value)
    this.ctx.jobs.define('backup.create', async () => void (await this.create('scheduled')))
    this.reschedule()
    this.ctx.inject(['health'], (ctx) => {
      ctx.health.check(
        'backups',
        () => {
          const { enabled, intervalHours } = this.settings_
          const last = this.list()[0]
          if (this.lastError) {
            return {
              level: 'error',
              message: `The last backup failed: ${this.lastError.message}`,
            }
          }
          if (!last) {
            return {
              level: 'warning',
              message: enabled ? 'No backup has been made yet.' : 'Backups are off and none exist.',
            }
          }
          const late = enabled && this.now() - last.createdAt > intervalHours * HOUR * 2 + HOUR
          if (late) {
            return {
              level: 'warning',
              message: `The newest backup is from ${new Date(last.createdAt).toLocaleString()}, older than the schedule allows.`,
            }
          }
          return {
            level: 'ok',
            message: `The newest backup is from ${new Date(last.createdAt).toLocaleString()}.`,
          }
        },
        { label: 'Backups', description: 'A recent backup exists.', link: '/system/backups' },
      )
    })
    this.ctx.inject(['api'], (ctx) => void ctx.plugin(routes, this))
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  // ---- settings

  settings(): schema.Settings {
    return { ...this.settings_ }
  }

  save(input: Partial<schema.Settings>) {
    const next = normalize({ ...this.settings_, ...input })
    const row = { key: KEY, value: next, updatedAt: this.now() }
    this.db
      .insert(schema.settings)
      .values(row)
      .onConflictDoUpdate({ target: schema.settings.key, set: row })
      .run()
    this.settings_ = next
    this.reschedule()
    this.prune()
    this.ctx.emit('backup/changed')
    return this.settings()
  }

  private reschedule() {
    this.unschedule?.()
    this.unschedule = undefined
    const { enabled, intervalHours } = this.settings_
    if (enabled)
      this.unschedule = this.ctx.jobs.schedule('backup', 'backup.create', intervalHours * HOUR)
  }

  // ---- files

  /** Where backups are kept; unset for an in-memory database. */
  get dir() {
    return this.ctx.database.backupDir
  }

  private get base() {
    return this.ctx.root.baseUrl ? fileURLToPath(this.ctx.root.baseUrl) : process.cwd()
  }

  list(): BackupFile[] {
    const dir = this.dir
    if (!dir || !existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => NAME.test(f))
      .map((name) => {
        const s = statSync(join(dir, name))
        return {
          name,
          size: s.size,
          createdAt: s.mtimeMs,
          reason: (name.endsWith('-manual.zip') ? 'manual' : 'scheduled') as Reason,
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
  }

  /** The path of a backup, for downloading. */
  path(name: string) {
    if (!NAME.test(name) || !this.dir) throw new Error(`no backup ${name}`)
    const file = join(this.dir, name)
    if (!existsSync(file)) throw new Error(`no backup ${name}`)
    return file
  }

  remove(name: string) {
    rmSync(this.path(name))
    this.ctx.emit('backup/changed')
  }

  private prune() {
    for (const old of this.list().slice(this.settings_.retention)) {
      rmSync(join(this.dir!, old.name), { force: true })
    }
  }

  // ---- making

  /** Writes a backup now and deletes the oldest ones beyond the retention. */
  async create(reason: Reason = 'manual'): Promise<BackupFile> {
    const dir = this.dir
    if (!dir) throw new Error('an in-memory database cannot be backed up')
    if (this.busy) throw new Error('a backup is already running')
    this.busy = true
    const at = this.now()
    const tmp = join(dir, `.snapshot-${at}.db`)
    try {
      mkdirSync(dir, { recursive: true })
      // a consistent copy of the live database; the file itself changes while we run
      this.ctx.database.sqlite.prepare('VACUUM INTO ?').run(tmp)
      const entries = [{ name: 'magpie.db', data: await readFile(tmp) }]
      const config = join(this.base, 'magpie.yml')
      const withConfig = this.settings_.includeConfig && existsSync(config)
      if (withConfig) entries.push({ name: 'magpie.yml', data: await readFile(config) })
      entries.push({
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify({ createdAt: new Date(at).toISOString(), reason, config: withConfig }),
        ),
      })
      const stamp = new Date(at).toISOString().replace(/[:.]/g, '-')
      const name = `magpie-backup-${stamp}-${reason}.zip`
      const target = join(dir, name)
      // written under another name first, so a crash never leaves half a backup in the list
      await writeFile(target + '.part', await writeZip(entries))
      renameSync(target + '.part', target)
      this.lastError = null
      this.prune()
      this.ctx.logger.info('backup written to %C', target)
      this.ctx.emit('backup/changed')
      const s = statSync(target)
      return { name, size: s.size, createdAt: s.mtimeMs, reason }
    } catch (error) {
      this.lastError = { at, message: error instanceof Error ? error.message : String(error) }
      this.ctx.emit('backup/changed')
      throw error
    } finally {
      this.busy = false
      try {
        rmSync(tmp, { force: true })
      } catch {
        // the folder itself may be what failed
      }
    }
  }

  // ---- restoring

  /**
   * Checks a backup and stages it; it replaces the database (and with `config`, magpie.yml)
   * the next time Magpie starts. The current database is kept as a snapshot then.
   */
  async restore(name: string, options: { config?: boolean } = {}): Promise<Staged> {
    const zip = readZip(await readFile(this.path(name)))
    if (!zip.names.includes('magpie.db')) throw new Error('this backup has no database')
    const db = await zip.read('magpie.db')
    const config = options.config && zip.names.includes('magpie.yml')
    if (options.config && !config) throw new Error('this backup has no settings file')

    const staging = join(this.base, RESTORE_DIR)
    this.cancelRestore()
    mkdirSync(staging, { recursive: true })
    const staged = join(staging, STAGED_DB)
    await writeFile(staged + '.part', db)
    try {
      verifyDatabase(staged + '.part')
    } catch (error) {
      rmSync(staged + '.part', { force: true })
      throw error
    }
    if (config) await writeFile(join(staging, STAGED_CONFIG), await zip.read('magpie.yml'))
    renameSync(staged + '.part', staged)
    await writeFile(join(staging, 'from.txt'), name)
    this.ctx.emit('backup/changed')
    return { from: name, config: !!config }
  }

  /** What the next start will restore, if a restore is waiting. */
  staged(): Staged | null {
    const staging = join(this.base, RESTORE_DIR)
    if (!existsSync(join(staging, STAGED_DB))) return null
    let from = 'a backup'
    try {
      from = readFileSync(join(staging, 'from.txt'), 'utf8').trim() || from
    } catch {
      // the note is only for display
    }
    return { from, config: existsSync(join(staging, STAGED_CONFIG)) }
  }

  cancelRestore() {
    rmSync(join(this.base, RESTORE_DIR), { recursive: true, force: true })
    this.ctx.emit('backup/changed')
  }
}

/** Refuses a file that is not an intact Magpie database. */
function verifyDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare('PRAGMA quick_check').all() as Record<string, string>[]
    if (rows.some((r) => Object.values(r)[0] !== 'ok'))
      throw new Error('the backup database is damaged')
    const has = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(MIGRATIONS_TABLE)
    if (!has) throw new Error("the backup doesn't look like a Magpie database")
  } finally {
    db.close()
  }
}

function normalize(value: Partial<schema.Settings> | undefined): schema.Settings {
  const d = schema.DEFAULT_SETTINGS
  const whole = (n: unknown, fallback: number, min: number, max: number) =>
    typeof n === 'number' && Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : d.enabled,
    intervalHours: whole(value?.intervalHours, d.intervalHours, 1, 24 * 30),
    retention: whole(value?.retention, d.retention, 1, 365),
    includeConfig:
      typeof value?.includeConfig === 'boolean' ? value.includeConfig : d.includeConfig,
  }
}

function routes(ctx: Context, backup: BackupService) {
  const guard = <T>(fn: () => T) => {
    try {
      return fn()
    } catch (error) {
      throw new ApiError(404, error instanceof Error ? error.message : String(error))
    }
  }
  const admin = ctx.api.as('system.admin')
  admin.get('/backups', () => ({
    settings: backup.settings(),
    backups: backup.list(),
    staged: backup.staged(),
  }))
  admin.post('/backups', async () => backup.create('manual'))
  admin.get('/backups/:name', async ({ params }) => {
    const file = guard(() => backup.path(params.name!))
    return new Response(await readFile(file), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${params.name}"`,
      },
    })
  })
  admin.delete('/backups/:name', ({ params }) => void guard(() => backup.remove(params.name!)))
  admin.post('/backups/:name/restore', async ({ params, body }) => {
    guard(() => backup.path(params.name!))
    try {
      return await backup.restore(params.name!, { config: !!body?.config })
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : String(error))
    }
  })
  admin.delete('/restore', () => void backup.cancelRestore())
}

export default BackupService
