// @magpiejs/settings: add, edit, disable and remove providers (indexers, download clients,
// metadata) from the web console. Each provider is a loader entry, so changes are written
// to magpie.yml and take effect right away (docs/phase-3.md §3).
//
// Providers are the installed packages whose package.json has `magpie.settings` (or the
// older `magpie.provider`). Where they appear is declared by the plugin that owns the page,
// with `magpie.hosts`; see docs/plugin-management.md.

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

/** What a settings page hosts, e.g. `indexer`. Declared by the plugin that owns the page. */
export type ProviderKind = string

/** A page that lists providers of one kind (`magpie.hosts` in the owning package). */
export interface Host {
  kind: ProviderKind
  label: string
  /** Console page where these providers are configured, e.g. `/settings/indexers`. */
  route?: string
}

export interface Provider {
  /** Package name, used as the loader entry's `name`. */
  name: string
  kind: ProviderKind
  label: string
  /** Where the form is shown. Only `provider-settings` exists so far. */
  slot: string
  /** `instances`: any number of entries. `single`: one entry only (e.g. TMDB). */
  mode: 'instances' | 'single'
  /** Only one entry of this provider makes sense (e.g. TMDB). */
  single: boolean
  fields: Field[]
  /** Fields shown up front; the rest are under "More options". All when unset. */
  basic?: string[]
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

/** A media type (movies, podcasts, …) that can be switched on or off. */
export interface MediaType {
  name: string
  label: string
  summary: string
  enabled: boolean
  /** Why it cannot be switched off now, in plain words. */
  blockedBy?: string
}

export type PluginState = 'active' | 'not-set-up' | 'disabled' | 'failed'

/** One row of Settings → Plugins. */
export interface PluginStatus {
  /** Display name, never a package name. */
  label: string
  /** The kind it belongs to, e.g. `indexer`, or `media-type`. */
  kind: string
  kindLabel: string
  state: PluginState
  /** Provider entries; 0 for media types. */
  instances: number
  /** Page where it is configured. */
  route?: string
  error?: string
}

/** What `package.json` declares about a plugin, beyond providers. */
interface Declared {
  mediaType?: { label: string; summary: string }
  needs: string[]
}

// a fiber that failed to start (cordis `FiberState.FAILED`)
const FAILED = 3

export interface Config {
  /** Where to look for provider packages. Defaults to this package's siblings. */
  packagesDir?: string
}

type Loaded = Provider & { schema: z; keys: Set<string> }

export class SettingsService extends Service {
  static inject = ['loader']

  private tree!: EntryTree
  private loaded = new Map<string, Loaded>()
  private hosts = new Map<ProviderKind, Host>()
  private declared = new Map<string, Declared>()

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
    this.ctx.inject(['health'], (ctx) => {
      ctx.health.check(
        'plugins',
        () => {
          const failed = this.plugins().filter((p) => p.state === 'failed')
          if (!failed.length) return { level: 'ok', message: 'Every plugin started.' }
          return {
            level: 'warning',
            message: `${failed.length} plugin${failed.length > 1 ? 's' : ''} could not start.`,
            details: failed.map((p) => p.label),
          }
        },
        {
          label: 'Plugins',
          description: 'Whether every provider and media type that is switched on started.',
          link: '/settings/plugins',
        },
      )
    })
  }

  private async discover() {
    const dir = this.config.packagesDir ?? fileURLToPath(new URL('../../', import.meta.url))
    const packages: Record<string, any>[] = []
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'package.json')
      if (!existsSync(file)) continue
      packages.push(JSON.parse(readFileSync(file, 'utf8')))
    }
    // pages first: a provider is only offered where some page hosts its kind
    for (const pkg of packages) {
      const hosts = pkg.magpie?.hosts
      if (hosts?.kind) this.hosts.set(hosts.kind, { ...hosts, label: hosts.label ?? hosts.kind })
      const mediaType = pkg.magpie?.mediaType
      this.declared.set(pkg.name, {
        mediaType: mediaType && {
          label: mediaType.label ?? pkg.name,
          summary: mediaType.summary ?? '',
        },
        needs: pkg.magpie?.needs ?? [],
      })
    }
    for (const pkg of packages) {
      const info = pkg.magpie?.settings ?? pkg.magpie?.provider
      if (!info) continue
      if (!this.hosts.has(info.kind)) {
        this.ctx.logger.warn('no page hosts %s settings, so %s is not offered', info.kind, pkg.name)
        continue
      }
      try {
        const exports = this.ctx.loader.unwrapExports(await this.tree.import(pkg.name))
        const schema: z | undefined = exports?.Config
        if (!schema) throw new Error('it has no Config')
        const mode = info.mode === 'single' || info.single ? 'single' : 'instances'
        this.loaded.set(pkg.name, {
          name: pkg.name,
          kind: info.kind,
          label: info.label ?? pkg.name,
          slot: info.slot ?? 'provider-settings',
          mode,
          single: mode === 'single',
          basic: info.basic,
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

  /** Entries of one package in magpie.yml. */
  private entriesOf(name: string) {
    return this.tree.root.data.filter((o) => o.name === name)
  }

  /** Whether an entry started and is still running. */
  private failed(id: string) {
    try {
      return this.tree.resolve(id).fiber?.state === FAILED
    } catch {
      return false
    }
  }

  /** Media types that can be switched on or off, as declared by their packages. */
  mediaTypes(): MediaType[] {
    const result: MediaType[] = []
    for (const [name, declared] of this.declared) {
      if (!declared.mediaType) continue
      const entries = this.entriesOf(name)
      const enabled = entries.some((o) => !o.disabled)
      result.push({
        name,
        ...declared.mediaType,
        enabled,
        blockedBy: enabled ? this.blockedBy(name) : undefined,
      })
    }
    return result.sort((a, b) => a.label.localeCompare(b.label))
  }

  /** The label of an enabled plugin that needs this one, if any. */
  private blockedBy(name: string) {
    for (const [other, declared] of this.declared) {
      if (!declared.needs.includes(name) || !this.entriesOf(other).some((o) => !o.disabled))
        continue
      return declared.mediaType?.label ?? this.loaded.get(other)?.label ?? other
    }
  }

  /** Switches a media type on or off. Its data is never touched. */
  async setMediaType(name: string, enabled: boolean) {
    const declared = this.declared.get(name)
    if (!declared?.mediaType) throw new Error(`${name} cannot be switched on or off`)
    if (!enabled) {
      const blocker = this.blockedBy(name)
      if (blocker) throw new Error(`${blocker} needs ${declared.mediaType.label}`)
    }
    const entries = this.entriesOf(name)
    if (!entries.length) {
      if (enabled) await this.tree.create({ name })
    } else {
      for (const entry of entries) {
        await this.tree.update(entry.id, { disabled: enabled ? null : true })
      }
    }
    this.ctx.emit('settings/changed')
  }

  /** Every provider and media type, with its state, for Settings → Plugins. */
  plugins(): PluginStatus[] {
    const rows: PluginStatus[] = []
    for (const provider of this.loaded.values()) {
      const host = this.hosts.get(provider.kind)!
      const entries = this.entriesOf(provider.name)
      const failed = entries.some((o) => !o.disabled && this.failed(o.id))
      const state: PluginState = failed
        ? 'failed'
        : entries.some((o) => !o.disabled)
          ? 'active'
          : entries.length
            ? 'disabled'
            : 'not-set-up'
      rows.push({
        label: provider.label,
        kind: provider.kind,
        kindLabel: host.label,
        state,
        instances: entries.length,
        route: host.route,
        error: failed ? 'It could not start. Check its settings and the logs.' : undefined,
      })
    }
    for (const type of this.mediaTypes()) {
      const failed = this.entriesOf(type.name).some((o) => !o.disabled && this.failed(o.id))
      rows.push({
        label: type.label,
        kind: 'media-type',
        kindLabel: 'Media types',
        state: failed ? 'failed' : type.enabled ? 'active' : 'disabled',
        instances: 0,
        route: '/settings/media',
        error: failed ? 'It could not start. Check the logs.' : undefined,
      })
    }
    return rows
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
