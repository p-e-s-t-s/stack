// Episode import: the downloaded file goes into the podcast's folder, named from the naming
// templates, then older files beyond the keep-latest setting are cleared. Loaded only while
// the import plugin is enabled.

import { extname, join, relative } from 'node:path'
import { ImportError, type ImportResult } from '@magpiejs/import'
import { renderName } from '@magpiejs/library'
import type { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import type { PodcastsService } from './index'
import * as schema from './schema'

export const PODCAST_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.wav',
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
]

export default function podcastImport(ctx: Context, podcasts: PodcastsService) {
  ctx.import.register(
    'podcast',
    async (item, grab, tools): Promise<ImportResult> => {
      const podcast = podcasts.get(item.id)
      if (!podcast) throw new ImportError('the podcast is no longer in the library')
      const link = podcasts.db
        .select()
        .from(schema.grabEpisodes)
        .where(eq(schema.grabEpisodes.grabId, grab.id))
        .get()
      const episode = link && podcasts.episode(link.episodeId)
      if (!episode) throw new ImportError('the episode is no longer in the podcast')

      const [file] = await tools.files()
      const naming = ctx.library.naming('podcast')
      const folder = ctx.library.folderOf(podcast)
      const name = renderName(naming.episodeFile!, {
        'Podcast Title': podcast.title,
        Author: podcast.details.author ?? undefined,
        'Published Date': episode.publishedAt?.slice(0, 10),
        'Episode Title': episode.title,
        season: episode.season ?? undefined,
        episode: episode.number ?? undefined,
      })
      const dest = join(folder, name + extname(file!.path).toLowerCase())

      const existing = podcasts.episodeFiles(podcast.id).get(episode.id)
      const oldPath = existing && join(folder, existing.path)
      if (oldPath === dest) await tools.recycle(dest)
      const method = await tools.place(file!.path, dest)
      if (existing) {
        if (oldPath !== dest) await tools.recycle(oldPath!)
        ctx.library.removeFile(existing.id)
      }
      const row = ctx.library.addFile({
        mediaId: podcast.id,
        path: relative(folder, dest),
        size: file!.size,
        quality: 'podcast-episode',
        formatScore: 0,
        languages: podcast.details.language ? [podcast.details.language.slice(0, 2)] : [],
        releaseName: grab.title,
        releaseGroup: null,
        revision: { version: 1, real: 0, proper: false, repack: false },
      })
      podcasts.linkFile(row.id, episode.id)
      await podcasts.applyRetention(podcast.id)
      ctx.emit('podcasts/episodes', podcast.id)
      return { path: dest, method, replaced: existing?.path }
    },
    { extensions: PODCAST_EXTENSIONS },
  )
}
