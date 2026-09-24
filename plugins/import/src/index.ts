// @magpiejs/import: moves finished downloads into the library (docs/phase-3.md §4.4).

import { extname, join, relative } from 'node:path'
import { isBetter, profileRanks, QUALITY_NAMES, type Quality } from '@magpiejs/decision'
import type { Grab } from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import { type MediaItem, renderName } from '@magpiejs/library'
import { parse } from '@magpiejs/parser'
import { type Context, Service } from 'cordis'
import { fileSystem, findVideo, recycle, transfer } from './files'

export * from './files'

declare module 'cordis' {
  interface Context {
    import: ImportService
  }
  interface Events {
    'import/completed'(
      item: MediaItem,
      grab: Grab,
      details: { path: string; method: string; replaced?: string },
    ): void
    'import/failed'(item: MediaItem | undefined, grab: Grab, reason: string): void
  }
}

/** A reason to stop importing that is shown to the user as-is. */
export class ImportError extends Error {}

export class ImportService extends Service {
  static inject = ['downloads', 'library', 'decision', 'jobs']

  fs = fileSystem

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
      if (!item) throw new ImportError('the movie is no longer in the library')
      const result = await this.importInto(item, grab)
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

  private async importInto(item: MediaItem, grab: Grab) {
    if (!grab.outputPath)
      throw new ImportError('the download client did not report where the download is')
    let video: Awaited<ReturnType<typeof findVideo>>
    try {
      video = await findVideo(grab.outputPath, this.fs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ImportError(
          `${grab.outputPath} does not exist (check that Magpie and the download client see the same paths)`,
        )
      }
      throw error
    }
    if (!video) throw new ImportError(`no video file found in ${grab.outputPath}`)

    const parsed = parse(grab.title)
    const quality = grab.quality as Quality
    const existing = this.ctx.library.files(item.id)[0]

    // it may no longer be an upgrade (another import won, or the profile changed)
    if (existing && !grab.manual) {
      const profile = this.ctx.decision.profile(item.profileId)
      if (profile) {
        const { rankOf } = profileRanks(profile)
        const candidate = {
          rank: rankOf(quality),
          formatScore: grab.formatScore,
          revision: parsed.revision,
        }
        const current = {
          rank: rankOf(existing.quality),
          formatScore: existing.formatScore,
          revision: existing.revision,
        }
        if (!isBetter(candidate, current))
          throw new ImportError('not an upgrade over the existing file')
      }
    }

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
    if (oldPath && oldPath === dest) await recycle(oldPath, naming.recycleBin, this.fs)

    const mode = grab.protocol === 'usenet' ? 'move' : naming.useHardlinks ? 'hardlink' : 'copy'
    const method = await transfer(video.path, dest, mode, this.fs)

    if (oldPath && oldPath !== dest) await recycle(oldPath, naming.recycleBin, this.fs)
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

export default ImportService
