// Movie import: places the main video of a finished download in the movie's folder. Loaded
// only while the import plugin is enabled.

import { basename, extname, join, relative } from 'node:path'
import type {} from '@magpiejs/decision'
import { ImportError, type ImportResult } from '@magpiejs/import'
import { renderName } from '@magpiejs/library'
import { parse } from '@magpiejs/parser'
import type { Context } from 'cordis'
import type { MoviesService } from './index'

export default function movieImport(ctx: Context, movies: MoviesService) {
  ctx.import.review.register('movie', {
    lookup: (term) => movies.lookup(term),
    async adopt(row, rootFolderId) {
      const existing = movies.list().find((m) => m.details.tmdbId === row.tmdbId)
      if (existing) {
        if (existing.folder !== row.folder || existing.rootFolderId !== rootFolderId)
          throw new ImportError('this movie exists in another folder')
        return existing
      }
      return movies.add({
        tmdbId: row.tmdbId!,
        profileId: row.profileId!,
        rootFolderId,
        folder: row.folder,
        monitored: false,
        search: false,
      })
    },
    plan(item, row) {
      const parsed = parse(row.releaseName ?? basename(row.source, extname(row.source)))
      const name = renderName(ctx.library.naming('movie').movieFile!, {
        Title: item.title,
        Year: item.year ?? undefined,
        Quality: ctx.decision.qualityName(row.quality),
        Edition: parsed.edition,
        Group: parsed.group,
        Resolution: parsed.resolution,
        Source: parsed.source,
      })
      return {
        destination: join(ctx.library.folderOf(item), name + extname(row.source).toLowerCase()),
        conflicts: ctx.library.files(item.id).map((f) => f.id),
      }
    },
    record() {},
    finishAdoption: (id, monitored) => {
      ctx.library.update(id, { monitored })
    },
  })
  ctx.import.register('movie', async (item, grab, tools): Promise<ImportResult> => {
    const video = (await tools.files())[0]!
    const parsed = parse(grab.title)
    const quality = grab.quality
    const existing = ctx.library.files(item.id)[0]

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

    const folder = ctx.library.folderOf(item)
    const dest = ctx.import.review
      .adapter('movie')
      .plan(item, { source: video.path, quality, releaseName: grab.title }).destination

    const oldPath = existing ? join(folder, existing.path) : undefined
    const method = await tools.place(video.path, dest)

    if (oldPath && oldPath !== dest) await tools.recycle(oldPath)
    if (existing) ctx.library.removeFile(existing.id)
    ctx.library.addFile({
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
    return {
      path: dest,
      method,
      replaced: existing ? existing.path : undefined,
      added: [dest],
      removed: oldPath && oldPath !== dest ? [oldPath] : [],
    }
  })
}
