// Downloading episodes: straight from the enclosure URL, through the downloads queue with the
// `http` protocol. Loaded only while the downloads plugin is enabled.

import type {} from '@magpiejs/downloads'
import type { ReleaseInfo } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { PodcastsService } from './index'

export default function podcastDownloads(ctx: Context, podcasts: PodcastsService) {
  /** Episodes of a podcast with a download in progress. */
  const downloading = (mediaId: number) =>
    new Set(ctx.downloads.activeFor(mediaId).flatMap((g) => g.unitIds))

  /** Grabs episodes (the wanted ones when not given; given ones even after failures). */
  async function download(mediaId: number, episodeIds?: number[]) {
    const podcast = podcasts.get(mediaId)
    if (!podcast) return 0
    const busy = downloading(mediaId)
    const files = podcasts.episodeFiles(mediaId)
    const episodes = episodeIds
      ? podcasts.episodes(mediaId).filter((e) => episodeIds.includes(e.id) && !files.has(e.id))
      : podcasts.wanted(mediaId)
    let grabbed = 0
    for (const episode of episodes) {
      if (busy.has(episode.id)) continue
      const release: ReleaseInfo = {
        guid: `podcast:${mediaId}:${episode.guid}`,
        title: `${podcast.title} - ${episode.title}`,
        protocol: 'http',
        indexerId: 'feed',
        downloadUrl: episode.enclosureUrl,
        size: episode.enclosureSize ?? undefined,
        publishedAt: episode.publishedAt ?? undefined,
      }
      try {
        await ctx.downloads.grab(mediaId, release, {
          quality: 'podcast-episode',
          formatScore: 0,
          manual: !!episodeIds,
          unitIds: [episode.id],
        })
        grabbed++
      } catch (error) {
        // no direct-download client, most likely: stop trying the rest
        ctx.logger.warn('could not download %s: %s', release.title, error)
        break
      }
    }
    if (grabbed) ctx.emit('podcasts/episodes', mediaId)
    return grabbed
  }

  ctx.effect(() => {
    podcasts.downloader = download
    return () => (podcasts.downloader = undefined)
  }, 'podcasts.downloader')

  ctx.on('podcasts/added', (podcast, options) => {
    if (options.download) void download(podcast.id)
  })
  ctx.on('podcasts/refreshed', (mediaId) => void download(mediaId))

  ctx.on('downloads/failed', (grab) => {
    if (!podcasts.get(grab.mediaId)) return
    for (const episodeId of ctx.downloads.unitsOf(grab.id))
      podcasts.failed(episodeId, grab.error ?? 'download failed')
  })
  for (const event of ['downloads/grabbed', 'downloads/updated'] as const) {
    ctx.on(event, (grab) => {
      if (podcasts.get(grab.mediaId)) ctx.emit('podcasts/episodes', grab.mediaId)
    })
  }
}
