import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkOwnership, getApplied, type Migration, readMigrations, runMigrations } from '../src'

const library = readMigrations(new URL('./fixtures/library/migrations', import.meta.url))
const subtitles = readMigrations(new URL('./fixtures/subtitles/migrations', import.meta.url))

let dir: string
let db: BetterSqlite3.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-db-'))
  db = new BetterSqlite3(join(dir, 'test.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('runMigrations', () => {
  it('applies migrations once and records them', () => {
    expect(runMigrations(db, { namespace: 'library', migrations: library })).toEqual([
      '0000_init',
      '0001_add_year',
      '0002_title_nullable',
    ])
    expect(runMigrations(db, { namespace: 'library', migrations: library })).toEqual([])
    expect(getApplied(db, 'library').map((m) => m.tag)).toHaveLength(3)
  })

  it('keeps child rows of another plugin through a parent table rebuild, and cascades after', () => {
    runMigrations(db, { namespace: 'library', migrations: library.slice(0, 2) })
    runMigrations(db, { namespace: 'subtitles', migrations: subtitles })
    db.exec(`INSERT INTO library_media (id, title) VALUES (1, 'a'), (2, 'b')`)
    db.exec(`INSERT INTO subtitles_assignments (media_id, profile) VALUES (1, 'en'), (2, 'de')`)

    // 0002 rebuilds library_media (create __new, copy, drop, rename)
    expect(runMigrations(db, { namespace: 'library', migrations: library })).toEqual([
      '0002_title_nullable',
    ])
    expect(count('subtitles_assignments')).toBe(2)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    db.exec('DELETE FROM library_media WHERE id = 1')
    expect(count('subtitles_assignments')).toBe(1)
  })

  it('rejects a foreign key violation left by a migration and rolls back', () => {
    runMigrations(db, { namespace: 'library', migrations: library })
    runMigrations(db, { namespace: 'subtitles', migrations: subtitles })
    const bad: Migration = {
      tag: '0001_orphan',
      hash: 'x',
      statements: [`INSERT INTO subtitles_assignments (media_id, profile) VALUES (99, 'en')`],
    }
    expect(() =>
      runMigrations(db, { namespace: 'subtitles', migrations: [...subtitles, bad] }),
    ).toThrow(/foreign key violation/)
    expect(count('subtitles_assignments')).toBe(0)
    expect(getApplied(db, 'subtitles')).toHaveLength(1)
  })

  it('rolls back every pending migration when one fails', () => {
    const broken: Migration = { tag: '0003_broken', hash: 'y', statements: ['SELECT * FROM nope'] }
    expect(() =>
      runMigrations(db, { namespace: 'library', migrations: [...library, broken] }),
    ).toThrow(/rolled back/)
    expect(getApplied(db, 'library')).toEqual([])
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'library%'`).all()
    expect(tables).toEqual([])
  })

  it('refuses edited migrations (drift)', () => {
    runMigrations(db, { namespace: 'library', migrations: library })
    const edited = library.map((m, i) => (i === 0 ? { ...m, hash: 'edited' } : m))
    expect(() => runMigrations(db, { namespace: 'library', migrations: edited })).toThrow(
      /changed after it was applied/,
    )
  })

  it('refuses to run an older plugin against newer data (downgrade)', () => {
    runMigrations(db, { namespace: 'library', migrations: library })
    expect(() =>
      runMigrations(db, { namespace: 'library', migrations: library.slice(0, 2) }),
    ).toThrow(/older than its data/)
  })

  it('refuses migrations that touch another plugin’s tables', () => {
    runMigrations(db, { namespace: 'library', migrations: library })
    const sneaky: Migration = {
      tag: '0000_sneaky',
      hash: 'z',
      statements: ['ALTER TABLE `library_media` ADD `subtitle_profile` text'],
    }
    expect(() => runMigrations(db, { namespace: 'subtitles', migrations: [sneaky] })).toThrow(
      /doesn't own: library_media/,
    )
  })

  it('runs TypeScript data steps inside the transaction', () => {
    runMigrations(db, {
      namespace: 'library',
      migrations: library,
      steps: {
        '0000_init': (tx) => tx.exec(`INSERT INTO library_media (id, title) VALUES (1, 'seed')`),
      },
    })
    expect(count('library_media')).toBe(1)
  })
})

describe('crash safety', () => {
  it('leaves the database unchanged when the process dies mid-migration', () => {
    const file = join(dir, 'crash.db')
    const script = new URL('./fixtures/crash.ts', import.meta.url).pathname
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', script, file], { stdio: 'pipe' }),
    ).toThrow()

    const after = new BetterSqlite3(file)
    try {
      expect(getApplied(after, 'library')).toEqual([])
      const tables = after
        .prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%library%'`)
        .all()
      expect(tables).toEqual([])
      // a normal restart applies everything
      expect(runMigrations(after, { namespace: 'library', migrations: library })).toHaveLength(3)
    } finally {
      after.close()
    }
  })
})

describe('checkOwnership', () => {
  it('allows own tables, drizzle rebuild tables and foreign key clauses', () => {
    const statements = [...library, ...subtitles].flatMap((m) => m.statements)
    expect(
      checkOwnership(
        library.flatMap((m) => m.statements),
        'library',
      ),
    ).toEqual([])
    expect(
      checkOwnership(
        subtitles.flatMap((m) => m.statements),
        'subtitles',
      ),
    ).toEqual([])
    expect(checkOwnership(statements, 'library').map((v) => v.name)).toContain(
      'subtitles_assignments',
    )
  })

  it('catches writes, indexes and drops on foreign tables', () => {
    const names = checkOwnership(
      [
        'INSERT INTO library_media (id) VALUES (1)',
        'UPDATE library_media SET title = 1',
        'DELETE FROM library_media',
        'CREATE INDEX `subtitles_idx` ON `library_media` (`title`)',
        'DROP TABLE IF EXISTS "library_media"',
        "INSERT INTO subtitles_x VALUES ('DROP TABLE library_media')",
      ],
      'subtitles',
    ).map((v) => v.name)
    expect(names).toEqual([
      'library_media',
      'library_media',
      'library_media',
      'library_media',
      'library_media',
    ])
  })
})
