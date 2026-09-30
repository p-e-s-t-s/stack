// Restoring a backup. A running database cannot be replaced, so the backup plugin stages
// the files in `<config dir>/restore/` and the next start swaps them in: the config file by
// the app before plugins load, the database here before it is opened. What was replaced is
// kept next to the backups, so a restore can be undone by restoring that.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const RESTORE_DIR = 'restore'
export const STAGED_DB = 'magpie.db'
export const STAGED_CONFIG = 'magpie.yml'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

/** Swaps in a staged database. `base` is the config directory. Returns whether it did. */
export function applyStagedDatabase(base: string, filename: string, backupDir: string) {
  const staged = join(base, RESTORE_DIR, STAGED_DB)
  if (!existsSync(staged)) return false
  if (existsSync(filename)) {
    mkdirSync(backupDir, { recursive: true })
    const keep = join(backupDir, `magpie-${stamp()}-before-restore.db`)
    const old = new DatabaseSync(filename)
    try {
      // also takes what is still in the write-ahead log
      old.prepare('VACUUM INTO ?').run(keep)
    } catch {
      copyFileSync(filename, keep)
    } finally {
      old.close()
    }
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true })
  copyFileSync(staged, filename)
  rmSync(staged, { force: true })
  return true
}

/** Swaps in a staged `magpie.yml`, keeping the old one as `magpie.yml.before-restore`. */
export function applyStagedConfig(base: string) {
  const staged = join(base, RESTORE_DIR, STAGED_CONFIG)
  if (!existsSync(staged)) return false
  const current = join(base, 'magpie.yml')
  if (existsSync(current)) copyFileSync(current, current + '.before-restore')
  copyFileSync(staged, current)
  rmSync(staged, { force: true })
  return true
}
