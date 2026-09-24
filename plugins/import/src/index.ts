// @magpiejs/import: moves finished downloads into the library (docs/phase-3.md §4.4).
// Each kind of media registers how its downloads are imported; movies are built in, series
// register theirs from the series plugin (docs/phase-4.md §4.3).

import { extname, join, relative } from 'node:path'
import { isBetter, profileRanks, QUALITY_NAMES, type Quality } from '@magpiejs/decision'
import type { Grab } from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import { type MediaItem, renderName } from '@magpiejs/library'
import { parse, type Revision } from '@magpiejs/parser'
import type { MediaKind } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { type FileSystem, fileSystem, findVideo, findVideos, recycle, transfer } from './files'

export * from './files'

declare module 'cordis' {
  interface Context {
    import: ImportService
  }
  interface Events {
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
  /** Files that were left out, with the reason. */
  skipped?: string[]
}

/** Imports one finished download for a library item of one kind. */
export type Importer = (item: MediaItem, grab: Grab, tools: ImportTools) => Promise<ImportResult>

/** Shared helpers for importers. */
export interface ImportTools {
  fs: FileSystem
  /** The video files of the download; throws an ImportError when there is none. */
  videos(): Promise<{ path: string; size: number }[]>
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

/** A reason to stop importing that is shown to the user as-is. */
export class ImportError extends Error {}

export class ImportService extends Service {
  static inject = ['downloads', 'library', 'decision', 'jobs']

  fs = fileSystem
  private importers = new Map<MediaKind, Importer>()

  constructor(ctx: Context) {
    super(ctx, 'import')
  }

  [Service.init]() {
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
    this.register('movie', (item, grab, tools) => this.importMovie(item, grab, tools))
  }

  /** Sets how downloads for a kind of media are imported, for the caller's lifetime. */
  register(kind: MediaKind, importer: Importer) {
    return this.ctx.effect(() => {
      this.importers.set(kind, importer)
      return () => this.importers.delete(kind)
    }, `import.register(${kind})`)
  }

  enqueue(grabId: number) {
    return this.ctx.jobs.enqueue('import.download', { grabId }, { dedupeKey: `import:${grabId}` })
  }

  /** Imports one finished download. Failures mark the grab `import_failed` with the reason. */
  async importGrab(grabId: number) {
    const grab = this.ctx.downloads.get(grabId)
    if (!grab || (grab.state !== 'import_pending' && grab.state !== 'import_failed')) return
    const item = this.ctx.library.get(grab.mediaId)
    this.ctx.downloads.setState(grab.id, 'importing')
    try {
      if (!item) throw new ImportError('the item is no longer in the library')
      const importer = this.importers.get(item.kind)
      if (!importer) throw new ImportError(`nothing can import ${item.kind} downloads right now`)
      const result = await importer(item, grab, this.tools(item, grab))
      this.ctx.downloads.setState(grab.id, 'imported')
      this.ctx.logger.info('imported %s to %s (%s)', grab.title, result.path, result.method)
      this.ctx.emit('import/completed', item, grab, result)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.ctx.downloads.setState(grab.id, 'import_failed', reason)
      this.ctx.logger.warn('import of %s failed: %s', grab.title, reason)
      this.ctx.emit('import/failed', item, grab, reason)
      // unexpected errors (e.g. disk full) are retried by the job; import errors are final
      if (!(error instanceof ImportError)) throw error
    }
  }

  private tools(item: MediaItem, grab: Grab): ImportTools {
    const naming = this.ctx.library.naming()
    const profile = this.ctx.decision.profile(item.profileId)
    return {
      fs: this.fs,
      videos: async () => {
        if (!grab.outputPath)
          throw new ImportError('the download client did not report where the download is')
        let videos: { path: string; size: number }[]
        try {
          videos = await findVideos(grab.outputPath, this.fs)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new ImportError(
              `${grab.outputPath} does not exist (check that Magpie and the download client see the same paths)`,
            )
          }
          throw error
        }
        if (!videos.length) throw new ImportError(`no video file found in ${grab.outputPath}`)
        return videos
      },
      place: (source, dest) => {
        // usenet and direct downloads aren't seeded: move them
        const mode =
          grab.protocol !== 'torrent' ? 'move' : naming.useHardlinks ? 'hardlink' : 'copy'
        return transfer(source, dest, mode, this.fs)
      },
      recycle: (path) => recycle(path, naming.recycleBin, this.fs),
      isUpgrade: (candidate, existing) => {
        if (!profile) return true
        const { rankOf } = profileRanks(profile)
        return isBetter(
          { ...candidate, rank: rankOf(candidate.quality as Quality) },
          { ...existing, rank: rankOf(existing.quality as Quality) },
        )
      },
    }
  }

  private async importMovie(
    item: MediaItem,
    grab: Grab,
    tools: ImportTools,
  ): Promise<ImportResult> {
    const video = (await tools.videos())[0]!
    const parsed = parse(grab.title)
    const quality = grab.quality as Quality
    const existing = this.ctx.library.files(item.id)[0]

    // it may no longer be an upgrade (another import won, or the profile changed)
    if (
      existing &&
      !grab.manual &&
      !tools.isUpgrade(
        { quality, formatScore: grab.formatScore, revision: parsed.revision },
        existing,
      )
    )
      throw new ImportError('not an upgrade over the existing file')

    const naming = this.ctx.library.naming()
    const folder = this.ctx.library.folderOf(item)
    const name = renderName(naming.movieFile, {
      Title: item.title,
      Year: item.year ?? undefined,
      Quality: QUALITY_NAMES[quality] ?? quality,
      Edition: parsed.edition,
      Group: parsed.group,
      Resolution: parsed.resolution,
      Source: parsed.source,
    })
    const dest = join(folder, name + extname(video.path).toLowerCase())

    // replace the old file first when it has the same name
    const oldPath = existing ? join(folder, existing.path) : undefined
    if (oldPath && oldPath === dest) await tools.recycle(oldPath)

    const method = await tools.place(video.path, dest)

    if (oldPath && oldPath !== dest) await tools.recycle(oldPath)
    if (existing) this.ctx.library.removeFile(existing.id)
    this.ctx.library.addFile({
      mediaId: item.id,
      path: relative(folder, dest),
      size: video.size,
      quality,
      formatScore: grab.formatScore,
      languages: parsed.languages,
      releaseName: grab.title,
      releaseGroup: parsed.group ?? null,
      revision: parsed.revision,
    })
    return { path: dest, method, replaced: existing ? existing.path : undefined }
  }
}

export { findVideo }
export default ImportService
