// @magpiejs/themes: the registry of web console themes, the instance default, and each
// user's own choice (docs/themes.md). A theme is a plugin that registers here and ships its
// parts and styles in a console entry; this service decides which of them apply to whom.
// The console reads its own chain over HTTP because per-user state cannot ride on the shared
// entry data.

import type { Request, Response } from '@cordisjs/plugin-server'
import type {} from '@cordisjs/plugin-server'
import type {} from '@magpiejs/auth'
import { DEFAULT_THEME } from '@magpiejs/console-kit'
import type { Drizzle } from '@magpiejs/database'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import { API_VERSION, chainOf, ID_PATTERN, resolveChain, type ThemeDefinition } from './chain'
import console_ from './console'
import * as schema from './schema'

export * from './chain'
export * from './schema'

declare module 'cordis' {
  interface Context {
    theme: ThemesService
  }
  interface Events {
    /** A theme was registered or removed, or the default or someone's choice changed. */
    'theme/changed'(): void
  }
}

/** The theme every chain ends in. It is part of the console, not a plugin. */
export const BUILT_IN: ThemeDefinition = {
  id: DEFAULT_THEME,
  name: 'Magpie',
  description: 'The built-in look.',
  apiVersion: API_VERSION,
  swatch: ['#f6f7f9', '#ffffff', '#2f6fde', '#1c1f24'],
}

export interface ThemeInfo extends ThemeDefinition {
  /** False when a parent theme is not installed, so choosing it would fall back to the default. */
  available: boolean
}

const DEFAULT_KEY = 'default'

export class ThemesService extends Service {
  static inject = ['database', 'server', 'auth']

  db!: Drizzle<typeof schema>
  private themes = new Map<string, ThemeDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'theme')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'themes',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.routes()
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  // ---- registry

  /** Add a theme for the caller's lifetime, like `ctx.health.check`. */
  register(definition: ThemeDefinition) {
    const { id } = definition
    if (id === DEFAULT_THEME) throw new Error(`"${DEFAULT_THEME}" is the built-in theme`)
    if (!ID_PATTERN.test(id))
      throw new Error(`theme id "${id}" must be lowercase letters, digits and dashes`)
    if (this.themes.has(id)) throw new Error(`a theme "${id}" is already registered`)
    if (definition.apiVersion > API_VERSION) {
      throw new Error(
        `theme "${id}" needs theme API ${definition.apiVersion}; this Magpie supports ${API_VERSION}`,
      )
    }
    const next = new Map(this.themes).set(id, definition)
    if (definition.extends && this.loops(id, next)) {
      throw new Error(`theme "${id}" extends itself through its parents`)
    }
    this.themes = next
    this.ctx.emit('theme/changed')
    return this.ctx.effect(() => () => {
      if (this.themes.get(id) !== definition) return
      const without = new Map(this.themes)
      without.delete(id)
      this.themes = without
      this.ctx.emit('theme/changed')
    })
  }

  /** Every theme, the built-in default first. */
  list(): ThemeInfo[] {
    return [BUILT_IN, ...this.themes.values()].map((theme) => ({
      ...theme,
      available: !!chainOf(theme.id, this.themes),
    }))
  }

  private loops(id: string, themes: ReadonlyMap<string, ThemeDefinition>) {
    const seen = new Set([id])
    for (let next = themes.get(id)?.extends; next && themes.has(next);) {
      if (seen.has(next)) return true
      seen.add(next)
      next = themes.get(next)?.extends
    }
    return false
  }

  // ---- choices

  /** The instance's theme for users who have not chosen; the built-in default when unset. */
  defaultId(): string {
    const row = this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, DEFAULT_KEY))
      .get()
    return row?.value ?? DEFAULT_THEME
  }

  setDefault(id: string | null) {
    if (id !== null) this.assertInstalled(id)
    if (id === null || id === DEFAULT_THEME) {
      this.db.delete(schema.settings).where(eq(schema.settings.key, DEFAULT_KEY)).run()
    } else {
      const row = { key: DEFAULT_KEY, value: id, updatedAt: Date.now() }
      this.db
        .insert(schema.settings)
        .values(row)
        .onConflictDoUpdate({ target: schema.settings.key, set: row })
        .run()
    }
    this.ctx.emit('theme/changed')
  }

  /** A user's own choice; null follows the instance default. */
  preference(userId: number): string | null {
    const row = this.db
      .select()
      .from(schema.preferences)
      .where(eq(schema.preferences.userId, userId))
      .get()
    return row?.themeId ?? null
  }

  setPreference(userId: number, id: string | null) {
    if (id === null) {
      this.db.delete(schema.preferences).where(eq(schema.preferences.userId, userId)).run()
    } else {
      this.assertInstalled(id)
      const row = { userId, themeId: id, updatedAt: Date.now() }
      this.db
        .insert(schema.preferences)
        .values(row)
        .onConflictDoUpdate({ target: schema.preferences.userId, set: row })
        .run()
    }
    this.ctx.emit('theme/changed')
  }

  /**
   * The themes that apply, most specific first, ending in the built-in default: the user's
   * choice, else the instance default, skipping any that is not installed or has lost a parent.
   */
  resolve(userId?: number): string[] {
    const mine = userId === undefined ? null : this.preference(userId)
    return resolveChain([mine, this.defaultId()], this.themes)
  }

  private assertInstalled(id: string) {
    if (id === DEFAULT_THEME) return
    if (!this.themes.has(id)) throw new ThemeError(`no theme "${id}" is installed`)
    if (!chainOf(id, this.themes)) throw new ThemeError(`theme "${id}" is missing a parent theme`)
  }

  // ---- HTTP: the console asks for its own chain

  private userId(req: Request) {
    const who = this.ctx.auth.identity(req)
    return who?.type === 'session' ? who.user.id : undefined
  }

  private routes() {
    const server = this.ctx.server
    server.get('/themes', async (req, res) => {
      const userId = this.userId(req)
      res.json({
        themes: this.list(),
        default: this.defaultId(),
        mine: userId === undefined ? null : this.preference(userId),
        chain: this.resolve(userId),
      })
    })
    server.put('/themes/me', async (req, res) => {
      const userId = this.userId(req)
      if (userId === undefined) return fail(res, 403, 'only a logged-in user has a theme choice')
      await this.change(req, res, (id) => this.setPreference(userId, id))
      if (res.status === 200) res.json({ ok: true, chain: this.resolve(userId) })
    })
    server.put('/themes/default', async (req, res) => {
      await this.change(req, res, (id) => this.setDefault(id))
      if (res.status === 200) res.json({ ok: true, chain: this.resolve(this.userId(req)) })
    })
  }

  private async change(req: Request, res: Response, apply: (id: string | null) => void) {
    try {
      const body = JSON.parse(await req.text()) as { id?: unknown }
      if (body.id !== null && typeof body.id !== 'string') {
        return fail(res, 400, 'send { "id": "<theme>" } or { "id": null }')
      }
      apply(body.id)
    } catch (error) {
      if (error instanceof ThemeError) return fail(res, 400, error.message)
      if (error instanceof SyntaxError) return fail(res, 400, 'send a JSON body')
      throw error
    }
  }
}

class ThemeError extends Error {}

function fail(res: Response, status: number, error: string) {
  res.status = status
  res.json({ error })
}

export default ThemesService
