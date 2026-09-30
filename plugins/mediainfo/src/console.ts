// Web console entry: the media-info panel on movie and series pages.

import type {} from '@magpiejs/webui'
import type { ToolStatus } from '@magpiejs/media-tools'
import type { ProbeFacts } from '@magpiejs/probe'
import type {} from '@magpiejs/series'
import type { Context } from 'cordis'
import type { MediaInfoService } from './index'

export interface MediaInfoView {
  fileId: number
  /** Relative to the item's folder. */
  path: string
  size: number
  /** The quality the release name gave the file, e.g. `bluray-1080p`. */
  quality: string
  /** Series only: the episodes this file holds. */
  episodes: { season: number; number: number }[]
  /** Null until the file has been probed, or when probing failed. */
  facts: ProbeFacts | null
  error: string | null
  probedAt: number | null
}

export interface MediaInfoData {
  /** Changes whenever any file is probed, so open panels know to reload. */
  version: number
  ffprobe: ToolStatus
  forMedia(mediaId: number): Promise<MediaInfoView[]>
  /** Probes a file again now. */
  reprobe(fileId: number): Promise<void>
}

export default function console_(ctx: Context, mediainfo: MediaInfoService) {
  let version = 0
  const bump = () =>
    entry.mutate((d) => {
      d.version = ++version
      d.ffprobe = ctx.mediaTools.status.ffprobe
    })
  ctx.on('mediainfo/updated', bump)
  ctx.on('media-tools/changed', bump)
  ctx.on('library/file-removed', bump)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: [],
    },
    {
      version,
      ffprobe: ctx.mediaTools.status.ffprobe,
      async forMedia(mediaId) {
        const series = ctx.get('series')
        const links = series?.episodeFiles(mediaId)
        const episodes = series?.episodes(mediaId) ?? []
        return mediainfo.forMedia(mediaId).map(({ file, info }) => ({
          fileId: file.id,
          path: file.path,
          size: file.size,
          quality: file.quality,
          episodes: episodes
            .filter((e) => links?.get(e.id)?.id === file.id)
            .map((e) => ({ season: e.season, number: e.number })),
          facts: info?.facts ?? null,
          error: info?.error ?? null,
          probedAt: info?.probedAt ?? null,
        }))
      },
      async reprobe(fileId) {
        await mediainfo.ensure(fileId, undefined, true)
      },
    } satisfies MediaInfoData,
  )
}
