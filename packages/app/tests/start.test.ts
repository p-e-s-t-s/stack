import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'tsx/esm/api'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultConfig, start } from '../src'

// the loader imports plugins with native import(); the CLI runs under tsx, so do the same
register()

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('start', () => {
  it('boots the plugins listed in magpie.yml from the config directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'magpie-app-'))
    writeFileSync(
      join(dir, 'magpie.yml'),
      [
        '- name: "@magpiejs/database"',
        '- name: "@magpiejs/jobs"',
        '  config:',
        '    pollInterval: 0',
      ].join('\n'),
    )
    const ctx = await start({ configDir: dir })
    expect(existsSync(join(dir, 'data/magpie.db'))).toBe(true)
    expect(ctx.get('jobs')).toBeTruthy()
    expect(
      ctx
        .get('database')!
        .status()
        .map((s: any) => s.namespace),
    ).toEqual(['jobs'])
    await ctx.fiber.dispose()
  })

  it('writes a default magpie.yml with the web console in the requested mode', () => {
    const entries = defaultConfig({ configDir: '.', dev: true, port: 1234 })
    expect(entries.map((e) => e.name)).toContain('@magpiejs/webui')
    expect(entries.find((e) => e.name === '@magpiejs/webui')?.config).toEqual({ devMode: true })
    expect(entries.find((e) => e.name === '@cordisjs/plugin-server')!.config).toMatchObject({
      port: 1234,
    })
  })
})
