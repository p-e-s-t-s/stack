// Production build of the web console: Magpie's shell, then the client entry of every
// plugin that has one (plugins/*/client/index.ts → plugins/*/dist).

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { build } from '@cordisjs/client/lib'

const plugins = new URL('../plugins/', import.meta.url).pathname

execFileSync('npm', ['run', 'build', '-w', '@magpiejs/webui'], { stdio: 'inherit' })

for (const name of readdirSync(plugins)) {
  const dir = join(plugins, name)
  if (!existsSync(join(dir, 'client', 'index.ts'))) continue
  console.log(`building client entry of plugins/${name}`)
  await build(dir)
}
