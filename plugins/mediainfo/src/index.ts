// @magpiejs/mediainfo: probes every library file with ffprobe and keeps what it finds, so
// pages can show what is really inside a file and other plugins (subtitles) read one copy
// instead of each probing on its own.

import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/jobs'
import type { MediaFile } from '@magpiejs/library'
import { mediaFiles } from '@magpiejs/library/schema'
import type {} from '@magpiejs/media-tools'
import { fingerprint as fingerprintOf, type ProbeFacts, probe } from '@magpiejs/probe'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import console_ from './console'
import * as schema from './schema'

export * from './schema'

declare module 'cordis' {
  interface Context {
    mediainfo: MediaInfoService
  }
  interface Events {
    /** A file was probed (facts or error recorded). */
    'mediainfo/updated'(fileId: number): void
  }
}

const DAY = 24 * 60 * 60_000

/** ffprobe is missing or broken; nothing is recorded and a later reconcile tries again. */
export class ToolUnavailableError extends Error {}

export interface Config {
  /** Files probed at the same time. */
  concurrency: number
  /** How long a failed probe of an unchanged file waits before it is tried again. */
  retryErrorsAfterMs: number
}

export class MediaInfoService extends Service {
  static inject = ['database', 'library', 'jobs', 'mediaTools']

  db!: Drizzle<typeof schema>
  config: Config
  /** Replaceable in tests. */
  probeFile: typeof probe = probe
  now = () => Date.now()
  private inflight = new Map<number, Promise<schema.FileInfo | undefined>>()
  private waiting: (() => void)[] = []
  private active = 0

  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'mediainfo')
    this.config = { concurrency: 2, retryErrorsAfterMs: 7 * DAY, ...config }
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'mediainfo',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define(
      'mediainfo.probe',
      async ({ fileId }: { fileId: number }, { signal }) => {
        try {
          await this.ensure(fileId, signal)
        } catch (error) {
          // not a failure of the job: reconcile queues the file again once ffprobe works
          if (!(error instanceof ToolUnavailableError)) throw error
        }
      },
      { maxAttempts: 1 },
    )
    this.ctx.jobs.define('mediainfo.reconcile', async () => void (await this.reconcile()), {
      maxAttempts: 1,
    })
    this.ctx.jobs.schedule('mediainfo.reconcile', 'mediainfo.reconcile', DAY)
    this.ctx.on('library/file-added', (_item, file) => void this.enqueue(file.id))
    // probing starts working when ffprobe is installed or its path is fixed
    this.ctx.on('media-tools/changed', () => {
      if (this.ctx.mediaTools.status.ffprobe.ok)
        void this.ctx.jobs.enqueue('mediainfo.reconcile', {})
    })
    void this.ctx.jobs.enqueue('mediainfo.reconcile', {}, { dedupeKey: 'mediainfo:startup' })
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  get(fileId: number) {
    return this.db.select().from(schema.files).where(eq(schema.files.fileId, fileId)).get()
  }

  /** What is known about each file of an item. */
  forMedia(mediaId: number) {
    return this.ctx.library.files(mediaId).map((file) => ({ file, info: this.get(file.id) }))
  }

  enqueue(fileId: number) {
    return this.ctx.jobs.enqueue(
      'mediainfo.probe',
      { fileId },
      { dedupeKey: `mediainfo:${fileId}` },
    )
  }

  private fileOf(fileId: number): { file: MediaFile; path: string } | undefined {
    const file = this.ctx.library.db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.id, fileId))
      .get()
    const item = file && this.ctx.library.get(file.mediaId)
    if (!file || !item) return
    const folder = this.ctx.library.folderOf(item)
    const path = resolve(folder, file.path)
    const rel = relative(folder, path)
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return
    return { file, path }
  }

  /**
   * The facts of a file, probing it first when there are none for its current version.
   * Concurrent requests for one file share one probe. Returns nothing when the file is gone;
   * throws when ffprobe is unavailable (nothing is recorded, so a later run retries).
   */
  ensure(fileId: number, signal?: AbortSignal, force = false) {
    let running = this.inflight.get(fileId)
    if (!running || force) {
      running = this.run(fileId, signal, force, 0).finally(() => this.inflight.delete(fileId))
      this.inflight.set(fileId, running)
    }
    return running
  }

  private async run(
    fileId: number,
    signal: AbortSignal | undefined,
    force: boolean,
    attempt: number,
  ): Promise<schema.FileInfo | undefined> {
    const located = this.fileOf(fileId)
    if (!located) return
    const print = await fingerprintOf(located.path)
    const old = this.get(fileId)
    if (!force && old?.fingerprint === print && (old.facts || !this.retryDue(old))) return old
    if (!(await this.ctx.mediaTools.available('ffprobe'))) {
      throw new ToolUnavailableError(
        `ffprobe is not available (${this.ctx.mediaTools.status.ffprobe.detail})`,
      )
    }
    let facts: ProbeFacts | null = null
    let error: string | null = null
    await this.slot()
    try {
      signal?.throwIfAborted()
      facts = await this.probeFile(located.path, this.ctx.mediaTools.path('ffprobe'), signal)
    } catch (e) {
      if (signal?.aborted) throw e
      error = e instanceof Error ? e.message : String(e)
    } finally {
      this.release()
    }
    // the file may have changed or gone away while ffprobe ran; try once more, then leave it
    // for the next reconcile rather than chase a file that keeps changing
    if ((await fingerprintOf(located.path).catch(() => undefined)) !== print)
      return attempt < 1 ? this.run(fileId, signal, force, attempt + 1) : undefined
    if (!this.fileOf(fileId)) return
    const row = { fileId, fingerprint: print, facts, error, probedAt: this.now() }
    this.db
      .insert(schema.files)
      .values(row)
      .onConflictDoUpdate({ target: schema.files.fileId, set: row })
      .run()
    this.ctx.emit('mediainfo/updated', fileId)
    return row
  }

  private async slot() {
    if (this.active >= this.config.concurrency) await new Promise<void>((r) => this.waiting.push(r))
    this.active++
  }

  private release() {
    this.active--
    this.waiting.shift()?.()
  }

  /** Queues a probe for every file that has no current facts. */
  async reconcile() {
    if (!(await this.ctx.mediaTools.available('ffprobe'))) return 0
    let queued = 0
    for (const item of this.ctx.library.list()) {
      for (const file of this.ctx.library.files(item.id)) {
        if (await this.stale(file.id)) {
          await this.enqueue(file.id)
          queued++
        }
      }
    }
    return queued
  }

  private async stale(fileId: number) {
    const located = this.fileOf(fileId)
    if (!located) return false
    const old = this.get(fileId)
    if (!old) return true
    const current = await stat(located.path).then(
      () => fingerprintOf(located.path),
      () => undefined,
    )
    if (current === undefined) return false
    if (current !== old.fingerprint) return true
    return this.retryDue(old)
  }

  /** A failed probe of an unchanged file is tried again after a while. */
  private retryDue(old: schema.FileInfo) {
    return !!old.error && this.now() - old.probedAt > this.config.retryErrorsAfterMs
  }
}

export default MediaInfoService
