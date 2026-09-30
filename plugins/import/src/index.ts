// @magpiejs/import: moves finished downloads into the library (docs/phase-3.md §4.4). It has
// no knowledge of any kind of media: each kind registers how its downloads are imported
// (movies and series from their plugins; docs/phase-4.5.md §3.5).

import { isBetter, profileRanks } from '@magpiejs/decision'
import type { Grab } from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import type { MediaItem } from '@magpiejs/library'
import type { Revision } from '@magpiejs/parser'
import type { MediaKind } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import {
  type FileSystem,
  fileSystem,
  findFiles,
  recycle,
  placeSafely,
  VIDEO_EXTENSIONS,
} from './files'
import { announceChange } from './changes'
import { ReviewService } from './review'
import reviewConsole from './console'

export * from './changes'
export * from './files'
export * from './review'

declare module 'cordis' {
  interface Context {
    import: ImportService
  }
  interface Events {
    'import/adapters'(): void
    'import/review'(): void
    'import/completed'(item: MediaItem, grab: Grab, details: ImportResult): void
    'import/failed'(item: MediaItem | undefined, grab: Grab, reason: string): void
  }
}

/** What an import did, for logs and history. */
export interface ImportResult {
  /** The imported file, or the first of several. */
  path: string
  method: string
  replaced?: string
  /** For downloads with several files (season packs). */
  files?: number
  /** Every file put into the library (absolute); defaults to `[path]`. */
  added?: string[]
  /** Every file taken out of the library by a replacement (absolute). */
  removed?: string[]
  /** Files that were left out, with the reason. */
  skipped?: string[]
}

/** Imports one finished download for a library item of one kind. */
export type Importer = (item: MediaItem, grab: Grab, tools: ImportTools) => Promise<ImportResult>

/** Shared helpers for importers. */
export interface ImportTools {
  fs: FileSystem
  /**
   * The download's files with the kind's extensions, largest first; throws an ImportError
   * when there is none.
   */
  files(): Promise<{ path: string; size: number }[]>
  /** Hardlink/copy (torrents) or move (usenet) a file into place, as the settings say. */
  place(source: string, dest: string): Promise<string>
  /** Moves a replaced file to the recycle bin, or deletes it. */
  recycle(path: string): Promise<void>
  /** Whether a release of this quality beats an existing file, per the item's profile. */
  isUpgrade(
    candidate: {
      quality: string
      formatScore: number
      revision: Revision
    },
    existing: { quality: string; formatScore: number; revision: Revision },
  ): boolean
}

export interface ImporterOptions {
  /** File extensions to import (lowercase, with the dot). Video by default. */
  extensions?: Iterable<string>
}

/** A reason to stop importing that is shown to the user as-is. */
export class ImportError extends Error {}

export class ImportService extends Service {
  static inject = ['database', 'downloads', 'library', 'decision', 'jobs']

  fs = fileSystem
  review!: ReviewService
  private importers = new Map<MediaKind, { importer: Importer; options: ImporterOptions }>()

  constructor(ctx: Context) {
    super(ctx, 'import')
  }

  [Service.init]() {
    this.review = new ReviewService(this.ctx)
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(reviewConsole, this.review))
    this.ctx.jobs.define(
      'import.download',
      ({ grabId }: { grabId: number }) => this.importGrab(grabId),
      { maxAttempts: 3, retryDelayMs: 60_000 },
    )
    this.ctx.on('downloads/completed', (grab) => this.enqueue(grab.id))
    // catches downloads that finished while Magpie (or this plugin) was stopped
    this.ctx.jobs.define('import.sweep', () => {
      for (const grab of this.ctx.downloads.active())
        if (grab.state === 'import_pending') this.enqueue(grab.id)
    })
    this.ctx.jobs.schedule('import.sweep', 'import.sweep', 5 * 60_000)
    this.ctx.jobs.define(
      'import.rescan',
      async () => {
        for (const item of this.ctx.library.list()) {
          if (!this.review.kinds().includes(item.kind as 'movie' | 'series')) continue
          try {
            const session = await this.review.scan({
              kind: item.kind as 'movie' | 'series',
              mode: 'rescan',
              path: this.ctx.library.folderOf(item),
              mediaId: item.id,
            })
            const preview = await this.review.preview(session.id, session.rows, 'hardlink')
            await this.review.commit(preview.id)
          } catch (error) {
            this.ctx.logger.warn('rescan of %s failed: %s', item.title, (error as Error).message)
          }
        }
      },
      { maxAttempts: 1 },
    )
    this.ctx.jobs.schedule('import.rescan-daily', 'import.rescan', 24 * 60 * 60_000)
  }

  /** Sets how downloads for a kind of media are imported, for the caller's lifetime. */
  register(kind: MediaKind, importer: Importer, options: ImporterOptions = {}) {
    return this.ctx.effect(() => {
      this.importers.set(kind, { importer, options })
      return () => this.importers.delete(kind)
    }, `import.register(${kind})`)
  }

  enqueue(grabId: number) {
    return this.ctx.jobs.enqueue('import.download', { grabId }, { dedupeKey: `import:${grabId}` })
  }

  /** Imports one finished download. Failures mark the grab `import_failed` with the reason. */
  async importGrab(grabId: number) {
    const grab = this.ctx.downloads.get(grabId)
    if (!grab) return
    return this.review.withItemLock(grab.mediaId, () => this.importGrabUnlocked(grabId))
  }

  private async importGrabUnlocked(grabId: number) {
    const grab = this.ctx.downloads.get(grabId)
    if (!grab || (grab.state !== 'import_pending' && grab.state !== 'import_failed')) return
    const item = this.ctx.library.get(grab.mediaId)
    this.ctx.downloads.setState(grab.id, 'importing')
    let result: ImportResult
    try {
      if (!item) throw new ImportError('the item is no longer in the library')
      const registered = this.importers.get(item.kind)
      if (!registered) throw new ImportError(`nothing can import ${item.kind} downloads right now`)
      result = await registered.importer(item, grab, this.tools(item, grab, registered.options))
      this.ctx.downloads.setState(grab.id, 'imported')
      this.ctx.logger.info('imported %s to %s (%s)', grab.title, result.path, result.method)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.ctx.downloads.setState(grab.id, 'import_failed', reason)
      this.ctx.logger.warn('import of %s failed: %s', grab.title, reason)
      this.ctx.emit('import/failed', item, grab, reason)
      // unexpected errors (e.g. disk full) are retried by the job; import errors are final
      if (!(error instanceof ImportError)) throw error
      return
    }
    // outside the try: a listener's error must not mark an imported grab as failed
    this.ctx.emit('import/completed', item!, grab, result)
    announceChange(this.ctx, {
      origin: 'download',
      item: item!,
      added: result.added ?? [result.path],
      removed: result.removed ?? [],
      replaced: !!result.replaced,
      release: grab.title,
    })
  }

  private tools(item: MediaItem, grab: Grab, options: ImporterOptions): ImportTools {
    const files = this.ctx.library.fileHandling()
    const profile = this.ctx.decision.profile(item.profileId)
    const extensions = new Set(options.extensions ?? VIDEO_EXTENSIONS)
    const video = !options.extensions
    return {
      fs: this.fs,
      files: async () => {
        if (!grab.outputPath)
          throw new ImportError('the download client did not report where the download is')
        let found: { path: string; size: number }[]
        try {
          found = await findFiles(grab.outputPath, extensions, { skipExtras: video }, this.fs)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new ImportError(
              `${grab.outputPath} does not exist (check that Magpie and the download client see the same paths)`,
            )
          }
          throw error
        }
        if (!found.length)
          throw new ImportError(
            `${video ? 'no video file' : 'no file to import'} found in ${grab.outputPath}`,
          )
        return found
      },
      place: (source, dest) => {
        // usenet and direct downloads aren't seeded: move them
        const mode = grab.protocol !== 'torrent' ? 'move' : files.useHardlinks ? 'hardlink' : 'copy'
        return placeSafely(source, dest, mode, files.recycleBin, this.fs)
      },
      recycle: (path) => recycle(path, files.recycleBin, this.fs),
      isUpgrade: (candidate, existing) => {
        if (!profile) return true
        const { rankOf } = profileRanks(profile)
        return isBetter(
          { ...candidate, rank: rankOf(candidate.quality) },
          { ...existing, rank: rankOf(existing.quality) },
        )
      },
    }
  }
}

export default ImportService
