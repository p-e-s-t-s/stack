#!/usr/bin/env -S node --import tsx
import { parseArgs } from 'node:util'
import { start } from './index'

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    dev: { type: 'boolean', default: false },
    port: { type: 'string', short: 'p' },
  },
})

const ctx = await start({
  configDir: values.config ?? process.env.MAGPIE_CONFIG_DIR ?? 'data',
  dev: values.dev,
  port: values.port ? Number(values.port) : undefined,
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) process.exit(1)
    stopping = true
    // dispose every plugin so the database closes cleanly
    await ctx.fiber.dispose()
    process.exit(0)
  })
}
