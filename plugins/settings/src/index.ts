// @magpiejs/settings: add, edit, disable and remove providers (indexers, download clients,
// metadata) from the web console. Each provider is a loader entry, so changes are written
// to magpie.yml and take effect right away (docs/phase-3.md §3).
//
// Providers are the installed packages whose package.json has `magpie.provider`.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EntryOptions, EntryTree } from '@cordisjs/plugin-loader'
import { type Context, Service } from 'cordis'
import type z from 'schemastery'
import console_ from './console'
import { type Field, fieldsOf } from './fields'

export * from './fields'

declare module 'cordis' {
  interface Context {
    settings: SettingsService
  }
  interface Events {
    'settings/changed'(): void
  }
}

export type ProviderKind = 'indexer' | 'download-client' | 'metadata'

export interface Provider {
  /** Package name, used as the loader entry's `name`. */
  name: string
  kind: ProviderKind
  label: string
  /** Only one entry of this provider makes sense (e.g. TMDB). */
  single: boolean
  fields: Field[]
}

export interface ProviderEntry {
  id: string
  name: string
  enabled: boolean
  /** Secrets are left out; see `secrets`. */
  config: Record<string, unknown>
  /** Secret fields that have a value. */
  secrets: string[]
}

export interface Config {
  /** Where to look for provider packages. Defaults to this package's siblings. */
  packagesDir?: string
}

type Loaded = Provider & { schema: z; keys: Set<string> }

export class SettingsService extends Service {
  static inject = ['loader']

  private tree!: EntryTree
  private loaded = new Map<string, Loaded>()

  config: Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'settings')
    this.config = config
  }

  async [Service.init]() {
    const entry = this.ctx.fiber.entry
    if (!entry) throw new Error('@magpiejs/settings has to be loaded by the loader (magpie.yml)')
    this.tree = entry.parent.tree
    await this.discover()
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  private async discover() {
    const dir = this.config.packagesDir ?? fileURLToPath(new URL('../../', import.meta.url))
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'package.json')
      if (!existsSync(file)) continue
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      const info = pkg.magpie?.provider
      if (!info) continue
      try {
        const exports = this.ctx.loader.unwrapExports(await this.tree.import(pkg.name))
        const schema: z | undefined = exports?.Config
        if (!schema) throw new Error('it has no Config')
        this.loaded.set(pkg.name, {
          name: pkg.name,
          kind: info.kind,
          label: info.label ?? pkg.name,
          single: !!info.single,
          fields: fieldsOf(schema),
          schema,
          keys: new Set(Object.keys((schema as { dict?: object }).dict ?? {})),
        })
      } catch (error) {
        this.ctx.logger.warn('cannot offer provider %s: %s', pkg.name, error)
      }
    }
  }

  providers(kind?: ProviderKind): Provider[] {
    return [...this.loaded.values()]
      .filter((p) => !kind || p.kind === kind)
      .map(({ schema: _, keys: __, ...p }) => p)
  }

  entries(kind?: ProviderKind): ProviderEntry[] {
    return this.tree.root.data
      .filter((o) => {
        const provider = this.loaded.get(o.name)
        return provider && (!kind || provider.kind === kind)
      })
      .map((o) => {
        const provider = this.loaded.get(o.name)!
        const config = { ...(o.config ?? {}) }
        const secrets: string[] = []
        for (const field of provider.fields) {
          if (field.type !== 'secret') continue
          if (config[field.key]) secrets.push(field.key)
          delete config[field.key]
        }
        return { id: o.id, name: o.name, enabled: !o.disabled, config, secrets }
      })
  }

  async add(name: string, config: Record<string, unknown>, enabled = true) {
    const provider = this.loaded.get(name)
    if (!provider) throw new Error(`${name} is not a provider`)
    if (provider.single && this.tree.root.data.some((o) => o.name === name))
      throw new Error(`${provider.label} is already set up`)
    config = this.validate(provider, config, enabled)
    const options: Omit<EntryOptions, 'id'> = { name, config }
    if (!enabled) options.disabled = true
    // the loader answers with the full path (`<include id>:<id>`); entries use the last part
    const id = (await this.tree.create(options)).split(':').pop()!
    this.ctx.emit('settings/changed')
    return id
  }

  /** Empty secret fields keep their current value. */
  async update(id: string, config: Record<string, unknown>, enabled: boolean) {
    const [options, provider] = this.find(id)
    // hidden settings (not in the form) are kept as they are
    const merged = { ...options.config, ...config }
    for (const field of provider.fields) {
      if (field.type === 'secret' && !merged[field.key] && options.config?.[field.key])
        merged[field.key] = options.config[field.key]
    }
    await this.tree.update(id, {
      config: this.validate(provider, merged, enabled),
      disabled: enabled ? null : true,
    })
    this.ctx.emit('settings/changed')
  }

  remove(id: string) {
    this.find(id)
    this.tree.remove(id)
    this.ctx.emit('settings/changed')
  }

  private find(id: string): [EntryOptions, Loaded] {
    const options = this.tree.root.data.find((o) => o.id === id)
    const provider = options && this.loaded.get(options.name)
    if (!options || !provider) throw new Error(`no provider entry ${id}`)
    return [options, provider]
  }

  /** Checks the config against the provider's schema; disabled entries may be incomplete. */
  private validate(provider: Loaded, config: Record<string, unknown>, enabled: boolean) {
    const clean = Object.fromEntries(
      Object.entries(config).filter(([k, v]) => provider.keys.has(k) && v !== undefined),
    )
    if (enabled) {
      try {
        provider.schema(clean)
      } catch (error) {
        throw new Error(`invalid settings: ${(error as Error).message}`, { cause: error })
      }
    }
    return clean
  }
}

export default SettingsService
