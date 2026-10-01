// Dev runner: restarts the server when plugin or package sources change.
// `tsx watch` is not used because Vite's temporary config file (written and deleted
// under plugins/webui/node_modules/.vite-temp on every start) counts as a changed
// dependency there and restarts the server forever.

import { type ChildProcess, spawn } from 'node:child_process'
import { type FSWatcher, readdirSync, watch } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const roots = ['../../../plugins', '../../../packages'].map(
  (p) => new URL(p + '/', import.meta.url),
)
const args = process.argv.slice(2)

let child: ChildProcess | undefined
let timer: NodeJS.Timeout | undefined

function start() {
  child = spawn(process.execPath, ['--import', 'tsx', cli, '--dev', ...args], { stdio: 'inherit' })
  child.on('exit', () => (child = undefined))
}

function restart() {
  console.log('[dev] source changed, restarting')
  const next = () => start()
  if (child) child.once('exit', next).kill()
  else next()
}

const watchers: FSWatcher[] = []
for (const root of roots) {
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    try {
      // only <package>/src, so build output, node_modules and temp files never trigger it
      watchers.push(
        watch(new URL(`${dir.name}/src`, root), { recursive: true }, (_, file) => {
          if (!file || !/\.(ts|mts|js|mjs|json|ya?ml)$/.test(file)) return
          clearTimeout(timer)
          timer = setTimeout(restart, 200)
        }),
      )
    } catch {
      // no src folder
    }
  }
}

function stop() {
  for (const w of watchers) w.close()
  child?.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
start()
