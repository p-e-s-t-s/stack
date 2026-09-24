// Applies the library migrations and kills the process from inside the transaction.
import BetterSqlite3 from 'better-sqlite3'
import { readMigrations, runMigrations } from '../../src/runner'

const db = new BetterSqlite3(process.argv[2]!)
db.pragma('journal_mode = WAL')
runMigrations(db, {
  namespace: 'library',
  migrations: readMigrations(new URL('./library/migrations', import.meta.url)),
  steps: {
    '0002_title_nullable': () => {
      process.kill(process.pid, 'SIGKILL')
    },
  },
})
