// CI check for the table ownership rule (docs/PLAN.md §3.0.1): every plugin's migrations
// may only create, change or write to tables and indexes with its own prefix. The plugin's
// namespace comes from `magpie.namespace` in its package.json.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkOwnership, NAMESPACE_PATTERN } from '@magpiejs/database/ownership'
import { readMigrations } from '@magpiejs/database/runner'

const root = new URL('../plugins/', import.meta.url).pathname
let failed = false
let checked = 0

for (const name of readdirSync(root)) {
  const dir = join(root, name)
  const migrations = join(dir, 'migrations')
  if (!existsSync(join(migrations, 'meta', '_journal.json'))) continue
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const namespace: unknown = pkg.magpie?.namespace
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    console.error(`${pkg.name}: has migrations but no valid "magpie.namespace" in package.json`)
    failed = true
    continue
  }
  for (const migration of readMigrations(migrations)) {
    checked++
    for (const v of checkOwnership(migration.statements, namespace)) {
      console.error(
        `${pkg.name} ${migration.tag}: ${v.kind} ${v.name} is not owned by "${namespace}"`,
      )
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log(`ownership check passed (${checked} migrations)`)
