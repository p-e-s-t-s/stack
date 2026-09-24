// Movie import: places the main video of a finished download in the movie's folder. Loaded
// only while the import plugin is enabled.

import { extname, join, relative } from 'node:path'
import type {} from '@magpiejs/decision'
import { ImportError, type ImportResult } from '@magpiejs/import'
import { renderName } from '@magpiejs/library'
import { parse } from '@magpiejs/parser'
import type { Context } from 'cordis'

export default function movieImport(ctx: Context) {
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

    const naming = ctx.library.naming('movie')
    const folder = ctx.library.folderOf(item)
    const name = renderName(naming.movieFile!, {
      Title: item.title,
      Year: item.year ?? undefined,
      Quality: ctx.decision.qualityName(quality),
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
    return { path: dest, method, replaced: existing ? existing.path : undefined }
  })
}
