import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkOwnership, getApplied, type Migration, readMigrations, runMigrations } from '../src'

const library = readMigrations(new URL('./fixtures/library/migrations', import.meta.url))
const subtitles = readMigrations(new URL('./fixtures/subtitles/migrations', import.meta.url))

let dir: string
let db: DatabaseSync

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-db-'))
  db = new DatabaseSync(join(dir, 'test.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('readMigrations', () => {
  it('reads the folder-per-migration layout in name order', () => {
    const root = join(dir, 'migrations')
    for (const [name, sql] of [
      ['20260102_second', 'ALTER TABLE `mig_a` ADD `b` text;'],
      [
        '20260101_first',
        'CREATE TABLE `mig_a` (`id` integer);\n--> statement-breakpoint\nCREATE INDEX `mig_a_idx` ON `mig_a` (`id`);',
      ],
    ] as const) {
      mkdirSync(join(root, name), { recursive: true })
      writeFileSync(join(root, name, 'migration.sql'), sql)
      writeFileSync(join(root, name, 'snapshot.json'), '{}')
    }
    const migrations = readMigrations(root)
    expect(migrations.map((m) => m.tag)).toEqual(['20260101_first', '20260102_second'])
    expect(migrations[0]!.statements).toHaveLength(2)
    expect(runMigrations(db, { namespace: 'mig', migrations })).toEqual([
      '20260101_first',
      '20260102_second',
    ])
  })

  it('still fails clearly when there is no migrations folder', () => {
    expect(() => readMigrations(join(dir, 'missing'))).toThrow('cannot read migration journal')
  })
})

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
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(
      1,
    )

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
    const script = fileURLToPath(new URL('./fixtures/crash.ts', import.meta.url))
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', script, file], { stdio: 'pipe' }),
    ).toThrow()

    const after = new DatabaseSync(file)
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
