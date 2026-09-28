// Applies the library migrations and kills the process from inside the transaction.
import { DatabaseSync } from 'node:sqlite'
import { readMigrations, runMigrations } from '../../src/runner'

const db = new DatabaseSync(process.argv[2]!)
db.exec('PRAGMA journal_mode = WAL')
runMigrations(db, {
  namespace: 'library',
  migrations: readMigrations(new URL('./library/migrations', import.meta.url)),
  steps: {
    '0002_title_nullable': () => {
      process.kill(process.pid, 'SIGKILL')
    },
  },
})
