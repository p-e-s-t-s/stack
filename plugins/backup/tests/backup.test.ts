import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService, { applyStagedConfig } from '@magpiejs/database'
import HealthService from '@magpiejs/health'
import JobsService from '@magpiejs/jobs'
import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BackupService from '../src'
import { readZip, writeZip } from '../src/zip'

let dir: string
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'magpie-backup-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function boot() {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir + '/').href
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: 'data/magpie.db' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(HealthService)
  await ctx.plugin(BackupService)
  return ctx
}

const note = (ctx: Context, text: string) =>
  ctx.database.sqlite.exec(
    `CREATE TABLE IF NOT EXISTS backup_test (t text); INSERT INTO backup_test VALUES ('${text}')`,
  )
const notes = (ctx: Context) =>
  (
    ctx.database.sqlite.prepare('SELECT t FROM backup_test ORDER BY rowid').all() as { t: string }[]
  ).map((r) => r.t)

describe('backups', () => {
  it('writes a zip with a snapshot of the database and magpie.yml', async () => {
    writeFileSync(join(dir, 'magpie.yml'), '- name: a\n')
    const ctx = await boot()
    note(ctx, 'one')
    const made = await ctx.backup.create('manual')
    expect(made.reason).toBe('manual')
    expect(ctx.backup.list().map((b) => b.name)).toEqual([made.name])

    const zip = readZip(readFileSync(ctx.backup.path(made.name)))
    expect(zip.names.sort()).toEqual(['magpie.db', 'magpie.yml', 'manifest.json'])
    expect((await zip.read('magpie.yml')).toString()).toBe('- name: a\n')
    expect(JSON.parse((await zip.read('manifest.json')).toString())).toMatchObject({
      reason: 'manual',
      config: true,
    })
    // no temporary files are left behind
    expect(
      readdirSync(ctx.backup.dir!).filter((f) => f.startsWith('.') || f.endsWith('.part')),
    ).toEqual([])
  })

  it('leaves the settings file out when asked', async () => {
    writeFileSync(join(dir, 'magpie.yml'), 'secret: 1\n')
    const ctx = await boot()
    ctx.backup.save({ includeConfig: false })
    const made = await ctx.backup.create()
    expect(readZip(readFileSync(ctx.backup.path(made.name))).names).not.toContain('magpie.yml')
  })

  it('keeps only the newest backups and never lists other files', async () => {
    const ctx = await boot()
    ctx.backup.save({ retention: 2 })
    writeFileSync(join(ctx.backup.dir!, 'magpie-2020-01-01-before-restore.db'), 'x')
    let t = Date.now()
    ctx.backup.now = () => (t += 1000)
    const names: string[] = []
    for (let i = 0; i < 4; i++) names.push((await ctx.backup.create('scheduled')).name)
    expect(
      ctx.backup
        .list()
        .map((b) => b.name)
        .sort(),
    ).toEqual(names.slice(2).sort())
    expect(existsSync(join(ctx.backup.dir!, 'magpie-2020-01-01-before-restore.db'))).toBe(true)
  })

  it('saves settings, clamps them and schedules the job only while enabled', async () => {
    const ctx = await boot()
    expect(ctx.backup.settings()).toMatchObject({ enabled: true, intervalHours: 24, retention: 7 })
    ctx.backup.save({ intervalHours: 0, retention: 9999 })
    expect(ctx.backup.settings()).toMatchObject({ intervalHours: 1, retention: 365 })
    ctx.backup.save({ enabled: false })
    ctx.backup.save({ enabled: true, intervalHours: 6 })
    const rows = ctx.jobs.db
      .select()
      .from((await import('@magpiejs/jobs/schema')).schedules)
      .all()
    expect(rows.find((r) => r.name === 'backup')?.intervalMs).toBe(6 * 3_600_000)
  })

  it('refuses names that are not backups', async () => {
    const ctx = await boot()
    expect(() => ctx.backup.path('../magpie.db')).toThrow('no backup')
    expect(() => ctx.backup.path('magpie-backup-x.zip')).toThrow('no backup')
  })

  it('stages a restore and the next start swaps the database and settings in', async () => {
    writeFileSync(join(dir, 'magpie.yml'), 'old: config\n')
    let ctx = await boot()
    note(ctx, 'before')
    const made = await ctx.backup.create('manual')
    note(ctx, 'after')
    writeFileSync(join(dir, 'magpie.yml'), 'new: config\n')

    const staged = await ctx.backup.restore(made.name, { config: true })
    expect(staged).toEqual({ from: made.name, config: true })
    expect(ctx.backup.staged()).toEqual(staged)
    // nothing changes while running
    expect(notes(ctx)).toEqual(['before', 'after'])
    await ctx.fiber.dispose()

    // what the app does before it reads magpie.yml
    expect(applyStagedConfig(dir)).toBe(true)
    expect(readFileSync(join(dir, 'magpie.yml'), 'utf8')).toBe('old: config\n')
    expect(readFileSync(join(dir, 'magpie.yml.before-restore'), 'utf8')).toBe('new: config\n')

    ctx = await boot()
    expect(notes(ctx)).toEqual(['before'])
    expect(ctx.backup.staged()).toBeNull()
    // the database it replaced is kept
    const kept = readdirSync(join(dir, 'data', 'backups')).filter((f) =>
      f.endsWith('-before-restore.db'),
    )
    expect(kept).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('can cancel a staged restore, and restores the database only unless told otherwise', async () => {
    writeFileSync(join(dir, 'magpie.yml'), 'a: 1\n')
    const ctx = await boot()
    const made = await ctx.backup.create('manual')
    expect(await ctx.backup.restore(made.name)).toMatchObject({ config: false })
    expect(existsSync(join(dir, 'restore', 'magpie.yml'))).toBe(false)
    ctx.backup.cancelRestore()
    expect(ctx.backup.staged()).toBeNull()
  })

  it('refuses a backup that is damaged or not a Magpie database', async () => {
    const ctx = await boot()
    const name = 'magpie-backup-2020-01-01T00-00-00-000Z-manual.zip'
    const put = async (entries: { name: string; data: Buffer }[]) =>
      writeFileSync(join(ctx.backup.dir!, name), await writeZip(entries))

    await put([{ name: 'manifest.json', data: Buffer.from('{}') }])
    await expect(ctx.backup.restore(name)).rejects.toThrow('no database')

    await put([
      { name: 'magpie.db', data: Buffer.from('this is not sqlite at all, not even close') },
    ])
    await expect(ctx.backup.restore(name)).rejects.toThrow()
    expect(ctx.backup.staged()).toBeNull()
    expect(existsSync(join(dir, 'restore', 'magpie.db.part'))).toBe(false)

    const other = join(dir, 'other.db')
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(other)
    db.exec('CREATE TABLE x (a)')
    db.close()
    await put([{ name: 'magpie.db', data: readFileSync(other) }])
    await expect(ctx.backup.restore(name)).rejects.toThrow("doesn't look like a Magpie database")

    await put([{ name: 'magpie.db', data: readFileSync(other) }])
    await expect(ctx.backup.restore(name, { config: true })).rejects.toThrow()
  })

  it('reports its freshness to health', async () => {
    const ctx = await boot()
    await ctx.health.run('backups')
    expect(ctx.health.list().find((c) => c.name === 'backups')).toMatchObject({ level: 'warning' })
    await ctx.backup.create('manual')
    await ctx.health.run('backups')
    expect(ctx.health.list().find((c) => c.name === 'backups')).toMatchObject({ level: 'ok' })

    ctx.backup.now = () => Date.now() + 3 * 24 * 3_600_000
    await ctx.health.run('backups')
    expect(ctx.health.list().find((c) => c.name === 'backups')?.level).toBe('warning')
  })

  it('reports a failed backup and recovers on the next success', async () => {
    const ctx = await boot()
    const dirPath = ctx.backup.dir!
    rmSync(dirPath, { recursive: true })
    writeFileSync(dirPath, 'a file where the folder should be')
    await expect(ctx.backup.create('scheduled')).rejects.toThrow(/EEXIST|ENOTDIR/)
    await ctx.health.run('backups')
    expect(ctx.health.list().find((c) => c.name === 'backups')).toMatchObject({ level: 'error' })
    rmSync(dirPath)
    await ctx.backup.create('scheduled')
    expect(ctx.backup.lastError).toBeNull()
  })
})
