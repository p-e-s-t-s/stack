import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Include from '@cordisjs/plugin-include'
import Loader from '@cordisjs/plugin-loader'
import { Context } from 'cordis'
import { register } from 'tsx/esm/api'
import { expect, it } from 'vitest'

// the loader imports plugins itself, like the app does under tsx
register()

it('adds, edits, disables and removes providers in magpie.yml', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-settings-'))
  const file = join(dir, 'magpie.yml')
  const ctx = new Context()
  await ctx.plugin(Loader, { baseUrl: import.meta.url })
  const includeId = await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: file, initial: [{ name: '@magpiejs/settings' }] },
  })
  await ctx.loader.await()
  const tree = ctx.loader.resolve(includeId).subtree as Include
  await tree.await()
  const settings = ctx.settings
  const yml = async () => (await tree.flush(), readFileSync(file, 'utf8'))

  expect(settings.providers().map((p) => [p.name, p.kind, p.single])).toEqual(
    expect.arrayContaining([
      ['@magpiejs/indexer-torznab', 'indexer', false],
      ['@magpiejs/downloader-qbittorrent', 'download-client', false],
      ['@magpiejs/metadata-tmdb', 'metadata', true],
    ]),
  )
  const tmdb = settings.providers('metadata').find((p) => p.name === '@magpiejs/metadata-tmdb')!
  expect(tmdb.fields.map((f) => [f.key, f.type])).toEqual([
    ['apiKey', 'secret'],
    ['language', 'string'],
  ])

  // required settings are checked for enabled entries
  await expect(settings.add('@magpiejs/metadata-tmdb', {})).rejects.toThrow(/invalid settings/)
  const id = await settings.add('@magpiejs/metadata-tmdb', {
    apiKey: 'secret-1',
    language: 'en-US',
  })
  expect(await yml()).toContain('secret-1')
  await expect(settings.add('@magpiejs/metadata-tmdb', { apiKey: 'x' })).rejects.toThrow(/already/)

  // secrets stay on the server, and an empty secret keeps the current one
  expect(settings.entries('metadata')).toEqual([
    {
      id,
      name: '@magpiejs/metadata-tmdb',
      enabled: true,
      config: { language: 'en-US' },
      secrets: ['apiKey'],
    },
  ])
  await settings.update(id, { apiKey: '', language: 'de-DE' }, false)
  const text = await yml()
  expect(text).toContain('secret-1')
  expect(text).toContain('de-DE')
  expect(text).toMatch(/disabled: true/)

  settings.remove(id)
  expect(await yml()).not.toContain('metadata-tmdb')
  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})
