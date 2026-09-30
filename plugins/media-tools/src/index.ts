// @magpiejs/media-tools: where ffprobe and ffmpeg are, and whether they work. Plugins that
// read media files (mediainfo, subtitles) inject this instead of each keeping a path.

import type { Drizzle } from '@magpiejs/database'
import { run } from '@magpiejs/probe'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    mediaTools: MediaToolsService
  }
  interface Events {
    /** The paths or the health of a tool changed. */
    'media-tools/changed'(): void
  }
}

export type Tool = keyof schema.Paths

export interface ToolStatus {
  ok: boolean
  /** `7.1` from `ffprobe version 7.1 …`, when the tool answered. */
  version?: string
  /** Why it is unavailable, or `available`. */
  detail: string
}

export type Status = Record<Tool, ToolStatus>

export const DEFAULT_PATHS: schema.Paths = { ffprobe: 'ffprobe', ffmpeg: 'ffmpeg' }
const KEY = 'paths'
const UNKNOWN: ToolStatus = { ok: false, detail: 'not checked yet' }

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ENOENT')) return 'not found'
  if (message.includes('EACCES')) return 'not executable'
  return message
}

export class MediaToolsService extends Service {
  static inject = ['database']

  db!: Drizzle<typeof schema>
  status: Status = { ffprobe: UNKNOWN, ffmpeg: UNKNOWN }
  private paths: schema.Paths = { ...DEFAULT_PATHS }
  private checking?: Promise<Status>

  constructor(ctx: Context) {
    super(ctx, 'mediaTools')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'mediatools',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.paths = { ...DEFAULT_PATHS, ...this.saved()?.value }
    void this.check()
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  private saved() {
    return this.db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  }

  /** The configured executable for a tool (a bare name is looked up on `PATH`). */
  path(tool: Tool) {
    return this.paths[tool]
  }

  settings(): schema.Paths {
    return { ...this.paths }
  }

  /** Checks both tools now, after any check already under way (which may use older paths). */
  check(): Promise<Status> {
    const next = (this.checking ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.probeTools())
      .then((status) => {
        const changed = JSON.stringify(status) !== JSON.stringify(this.status)
        this.status = status
        if (changed) this.ctx.emit('media-tools/changed')
        return status
      })
    this.checking = next
    void next.finally(() => {
      if (this.checking === next) this.checking = undefined
    })
    return next
  }

  private async probeTools(): Promise<Status> {
    const status: Status = { ffprobe: UNKNOWN, ffmpeg: UNKNOWN }
    for (const tool of ['ffprobe', 'ffmpeg'] as const) {
      try {
        const output = await run(this.paths[tool], ['-version'], undefined, 5_000)
        const version = /version\s+(\S+)/.exec(output.split('\n')[0] ?? '')?.[1]
        status[tool] = { ok: true, version, detail: 'available' }
      } catch (error) {
        status[tool] = { ok: false, detail: describe(error) }
      }
    }
    return status
  }

  /** Whether a tool worked at the last check; waits for a check that is under way. */
  async available(tool: Tool) {
    if (this.checking) await this.checking
    return this.status[tool].ok
  }

  /** Saves new paths and checks them. */
  async save(input: Partial<schema.Paths>) {
    const next = { ...this.paths }
    for (const tool of ['ffprobe', 'ffmpeg'] as const) {
      const value = input[tool]
      if (value === undefined) continue
      if (typeof value !== 'string' || !value.trim() || value.length > 500 || value.includes('\0'))
        throw new Error(`${tool} needs an executable name or path`)
      next[tool] = value.trim()
    }
    this.write(next)
    return this.check()
  }

  /**
   * Adopts a path another plugin used to keep (subtitles' old `ffprobe` setting), unless
   * one has been saved here already.
   */
  async adopt(tool: Tool, path: string) {
    if (this.saved() || !path.trim() || path === DEFAULT_PATHS[tool]) return
    await this.save({ [tool]: path })
  }

  private write(value: schema.Paths) {
    this.paths = value
    this.db
      .insert(schema.settings)
      .values({ key: KEY, value, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
      .run()
    this.ctx.emit('media-tools/changed')
  }
}

export default MediaToolsService
