import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Include from '@cordisjs/plugin-include'
import Loader from '@cordisjs/plugin-loader'
import { Context } from 'cordis'
import { register } from 'tsx/esm/api'
import { expect, it } from 'vitest'

// the loader imports plugins itself, like the app does under tsx
register()

/** Starts settings from a magpie.yml with the given entries; `config` is settings' own. */
async function start(initial: object[], config?: object) {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-settings-'))
  const file = join(dir, 'magpie.yml')
  const ctx = new Context()
  await ctx.plugin(Loader, { baseUrl: import.meta.url })
  const includeId = await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: file, initial: [{ name: '@magpiejs/settings', config }, ...initial] },
  })
  await ctx.loader.await()
  const tree = ctx.loader.resolve(includeId).subtree as Include
  await tree.await()
  const yml = async () => (await tree.flush(), readFileSync(file, 'utf8'))
  const stop = async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
  return { ctx, settings: ctx.settings, yml, stop }
}

it('adds, edits, disables and removes providers in magpie.yml', async () => {
  const { settings, yml, stop } = await start([])

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
  await stop()
})

it('takes the kinds from the packages that host them', async () => {
  const { settings, stop } = await start([])
  // the pages that host each kind declare it, with where they are
  expect(settings.providers().map((p) => p.kind)).toEqual(
    expect.arrayContaining(['indexer', 'download-client', 'metadata', 'notifier']),
  )
  expect(settings.providers('indexer').every((p) => p.slot === 'provider-settings')).toBe(true)
  const rows = settings.plugins()
  expect(rows.find((r) => r.kind === 'metadata' && r.label.includes('TMDB'))).toMatchObject({
    kind: 'metadata',
    kindLabel: 'Metadata',
    state: 'not-set-up',
    instances: 0,
    route: '/settings/metadata',
  })
  await stop()

  // a provider is not offered when no page hosts its kind
  const none = await start([], {
    packagesDir: fileURLToPath(new URL('./fixtures/needs', import.meta.url)),
  })
  expect(none.settings.providers()).toEqual([])
  await none.stop()
})

it('reports the state of each plugin', async () => {
  const { settings, stop } = await start([])
  const id = await settings.add('@magpiejs/metadata-tmdb', { apiKey: 'k' }, false)
  const tmdb = () =>
    settings.plugins().find((r) => r.kind === 'metadata' && r.label.includes('TMDB'))
  expect(tmdb()).toMatchObject({ state: 'disabled', instances: 1 })
  await settings.update(id, { apiKey: '' }, true)
  expect(tmdb()).toMatchObject({ state: 'active', instances: 1 })
  await stop()
})

it('switches media types on and off without touching anything else', async () => {
  const { settings, yml, stop } = await start([{ name: '@magpiejs/podcasts', disabled: true }])
  expect(settings.mediaTypes().map((t) => [t.label, t.enabled])).toEqual(
    expect.arrayContaining([['Podcasts', false]]),
  )
  expect(settings.plugins().find((r) => r.label === 'Podcasts')).toMatchObject({
    kind: 'media-type',
    state: 'disabled',
    route: '/settings/media',
  })

  await settings.setMediaType('@magpiejs/podcasts', true)
  expect(await yml()).not.toMatch(/disabled: true/)
  expect(settings.mediaTypes().find((t) => t.label === 'Podcasts')?.enabled).toBe(true)
  await settings.setMediaType('@magpiejs/podcasts', false)
  expect(await yml()).toMatch(/disabled: true/)

  // only plugins that opt in can be switched
  await expect(settings.setMediaType('@magpiejs/settings', false)).rejects.toThrow(/cannot be/)
  await stop()
})

it('will not switch a media type off while an enabled plugin needs it', async () => {
  // the fixture packages stand in for a media type and a plugin that declares `needs` on it
  const dir = fileURLToPath(new URL('./fixtures/needs', import.meta.url))
  const { settings, stop } = await start([{ name: '@magpiejs/podcasts', disabled: true }], {
    packagesDir: dir,
  })
  await settings.setMediaType('@magpiejs/podcasts', true)
  expect(settings.mediaTypes()[0]).toMatchObject({ enabled: true, blockedBy: '@magpiejs/settings' })
  await expect(settings.setMediaType('@magpiejs/podcasts', false)).rejects.toThrow(/needs Podcasts/)
  await stop()
})
