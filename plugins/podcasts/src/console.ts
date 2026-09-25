// Web console entry: Podcasts, Add podcast and Podcast detail pages.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/webui'
import type { MetadataSearchResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import { MAX_ATTEMPTS, type PodcastsService, type PodcastStats } from './index'
import { toOpml } from './opml'
import * as schema from './schema'

export interface PodcastSummary {
  id: number
  title: string
  author: string | null
  overview: string | null
  posterUrl: string | null
  monitored: boolean
  rootFolderId: number
  folder: string
  feedUrl: string
  link: string | null
  monitorNew: boolean
  keepLatest: number | null
  refreshedAt: number | null
  refreshError: string | null
  stats: PodcastStats
}

export interface PodcastEpisodeRow {
  id: number
  title: string
  description: string | null
  publishedAt: string | null
  durationSeconds: number | null
  size: number | null
  monitored: boolean
  /** Stopped retrying after repeated failures. */
  failed: boolean
  lastError: string | null
  file?: { path: string; size: number }
  download?: { state: string; progress: number }
}

export interface FeedPreview {
  title: string
  author?: string
  description?: string
  imageUrl?: string
  episodes: number
  latest?: string
  libraryId?: number
}

export interface PodcastsData {
  podcasts: PodcastSummary[]
  rootFolders: { id: number; path: string }[]
  /** Whether a direct-download client is set up. */
  canDownload: boolean
  /** Bumped per podcast when its episodes or files change; pages refetch `episodes`. */
  revision: Record<number, number>
  lookup(term: string): Promise<(MetadataSearchResult & { libraryId?: number })[]>
  preview(feedUrl: string): Promise<FeedPreview>
  add(options: {
    feedUrl: string
    itunesId?: string
    rootFolderId: number
    monitor: schema.MonitorOption
    latestCount: number
    keepLatest: number | null
  }): Promise<number>
  episodes(id: number): Promise<PodcastEpisodeRow[]>
  update(
    id: number,
    patch: { monitored?: boolean; monitorNew?: boolean; keepLatest?: number | null },
  ): Promise<void>
  monitorEpisode(episodeId: number, monitored: boolean): Promise<void>
  /** Downloads these episodes now (the wanted ones when none are given). Says what happened. */
  download(id: number, episodeIds?: number[]): Promise<string>
  refresh(id: number): Promise<void>
  remove(id: number, deleteFiles: boolean): Promise<void>
  exportOpml(): Promise<string>
  importOpml(
    xml: string,
    options: { rootFolderId: number; monitor: schema.MonitorOption },
  ): Promise<{ added: string[]; skipped: string[]; failed: string[] }>
}

export default function console_(ctx: Context, podcasts: PodcastsService) {
  const summaries = (): PodcastSummary[] =>
    podcasts.list().map((p) => ({
      id: p.id,
      title: p.title,
      author: p.details.author,
      overview: p.overview,
      posterUrl: p.posterUrl,
      monitored: p.monitored,
      rootFolderId: p.rootFolderId,
      folder: p.folder,
      feedUrl: p.details.feedUrl,
      link: p.details.link,
      monitorNew: p.details.monitorNew,
      keepLatest: p.details.keepLatest,
      refreshedAt: p.details.refreshedAt,
      refreshError: p.details.refreshError,
      stats: p.stats,
    }))

  const snapshot = () => ({
    podcasts: summaries(),
    rootFolders: ctx.library.rootFolders('podcast').map((f) => ({ id: f.id, path: f.path })),
    canDownload: !!ctx
      .get('downloads')
      ?.listClients()
      .some((c) => c.protocol === 'http'),
  })

  const changed = new Set<number>()
  const flush = ctx.debounce(
    () =>
      entry.mutate((d) => {
        Object.assign(d, snapshot())
        for (const id of changed) d.revision[id] = (d.revision[id] ?? 0) + 1
        changed.clear()
      }),
    100,
  )
  const touch = (id?: number) => {
    if (id !== undefined) changed.add(id)
    flush()
  }
  ctx.on('podcasts/episodes', (id) => touch(id))
  for (const event of ['library/added', 'library/updated', 'library/deleted'] as const)
    ctx.on(event, (item) => touch(item.id))
  for (const event of ['library/file-added', 'library/file-removed'] as const)
    ctx.on(event, (item) => touch(item.id))
  ctx.on('library/root-folders', () => touch())
  ctx.on('downloads/clients', () => touch())

  /** Download progress by episode id. */
  function downloads(mediaId: number) {
    const result = new Map<number, { state: string; progress: number }>()
    for (const grab of ctx.get('downloads')?.activeFor(mediaId) ?? [])
      for (const id of grab.unitIds) result.set(id, { state: grab.state, progress: grab.progress })
    return result
  }

  const data: PodcastsData = {
    ...snapshot(),
    revision: {},
    lookup: (term) => podcasts.lookup(term),
    async preview(feedUrl) {
      const preview = await podcasts.preview(feedUrl)
      const libraryId = podcasts.list().find((p) => p.details.feedUrl === feedUrl.trim())?.id
      return { ...preview, libraryId }
    },
    async add(options) {
      return (await podcasts.add(options)).id
    },
    async episodes(id) {
      const files = podcasts.episodeFiles(id)
      const active = downloads(id)
      return podcasts.episodes(id).map((e) => {
        const file = files.get(e.id)
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          publishedAt: e.publishedAt,
          durationSeconds: e.durationSeconds,
          size: e.enclosureSize,
          monitored: e.monitored,
          failed: e.attempts >= MAX_ATTEMPTS,
          lastError: e.lastError,
          file: file && { path: file.path, size: file.size },
          download: active.get(e.id),
        }
      })
    },
    async update(id, patch) {
      podcasts.update(id, patch)
    },
    async monitorEpisode(episodeId, monitored) {
      podcasts.monitorEpisodes([episodeId], monitored)
    },
    async download(id, episodeIds) {
      if (!podcasts.downloader) return 'Downloads are turned off.'
      const count = await podcasts.downloader(id, episodeIds)
      if (count) return `Downloading ${count} episode${count === 1 ? '' : 's'}.`
      if (!snapshot().canDownload) return 'Add a direct-download client in Settings first.'
      return episodeIds ? 'Already downloaded or downloading.' : 'Nothing to download.'
    },
    refresh: (id) => podcasts.refresh(id),
    async remove(id, deleteFiles) {
      podcasts.remove(id, deleteFiles)
    },
    async exportOpml() {
      return toOpml(podcasts.list().map((p) => ({ title: p.title, feedUrl: p.details.feedUrl })))
    },
    importOpml: (xml, options) => podcasts.importOpml(xml, options),
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/podcasts', '/podcasts/add', '/podcasts/:id'],
    },
    data,
  )
}
