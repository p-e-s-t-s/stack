// Web console entry: Series, Add series and Series detail pages.

import type {} from '@magpiejs/webui'
import { QUALITY_NAMES, type Quality } from '@magpiejs/decision/qualities'
import type { MetadataSearchResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import { hasAired, type SeriesService, type SeriesStats } from './index'
import type { MonitorOption, SeriesType } from './schema'

export interface SeriesSummary {
  id: number
  title: string
  year: number | null
  overview: string | null
  posterUrl: string | null
  monitored: boolean
  profileId: number
  rootFolderId: number
  folder: string
  tmdbId: number
  seriesType: SeriesType
  seasonFolders: boolean
  status: string | null
  network: string | null
  genres: string[]
  stats: SeriesStats
  seasons: { number: number; title: string | null; monitored: boolean }[]
}

export interface EpisodeRow {
  id: number
  season: number
  number: number
  absoluteNumber: number | null
  title: string | null
  airDate: string | null
  aired: boolean
  monitored: boolean
  file?: { path: string; quality: string; size: number }
}

export interface SeriesData {
  series: SeriesSummary[]
  profiles: { id: number; name: string }[]
  rootFolders: { id: number; path: string }[]
  /** Bumped per series when its episodes or files change; pages refetch `episodes`. */
  revision: Record<number, number>
  lookup(term: string): Promise<(MetadataSearchResult & { libraryId?: number })[]>
  add(options: {
    tmdbId: number
    profileId: number
    rootFolderId: number
    seriesType: SeriesType
    seasonFolders: boolean
    monitor: MonitorOption
    search: boolean
  }): Promise<number>
  episodes(id: number): Promise<EpisodeRow[]>
  update(
    id: number,
    patch: {
      profileId?: number
      monitored?: boolean
      seriesType?: SeriesType
      seasonFolders?: boolean
    },
  ): Promise<void>
  monitorSeason(id: number, season: number, monitored: boolean): Promise<void>
  monitorEpisode(episodeId: number, monitored: boolean): Promise<void>
  refresh(id: number): Promise<void>
  remove(id: number, deleteFiles: boolean): Promise<void>
}

export default function console_(ctx: Context, series: SeriesService) {
  const summaries = (): SeriesSummary[] =>
    series.list().map((s) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      overview: s.overview,
      posterUrl: s.posterUrl,
      monitored: s.monitored,
      profileId: s.profileId,
      rootFolderId: s.rootFolderId,
      folder: s.folder,
      tmdbId: s.details.tmdbId,
      seriesType: s.details.seriesType,
      seasonFolders: s.details.seasonFolders,
      status: s.details.status,
      network: s.details.network,
      genres: s.details.genres ?? [],
      stats: s.stats,
      seasons: s.seasons.map(({ number, title, monitored }) => ({ number, title, monitored })),
    }))

  const snapshot = () => ({
    series: summaries(),
    profiles: ctx.decision.profiles().map((p) => ({ id: p.id, name: p.name })),
    rootFolders: ctx.library.rootFolders('series').map((f) => ({ id: f.id, path: f.path })),
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
  ctx.on('series/episodes', (id) => touch(id))
  for (const event of ['library/added', 'library/updated', 'library/deleted'] as const)
    ctx.on(event, (item) => touch(item.id))
  for (const event of ['library/file-added', 'library/file-removed'] as const)
    ctx.on(event, (item) => touch(item.id))
  ctx.on('library/root-folders', () => touch())

  const data: SeriesData = {
    ...snapshot(),
    revision: {},
    lookup: (term) => series.lookup(term),
    async add(options) {
      return (await series.add(options)).id
    },
    async episodes(id) {
      const files = series.episodeFiles(id)
      return series.episodes(id).map((e) => {
        const file = files.get(e.id)
        return {
          id: e.id,
          season: e.season,
          number: e.number,
          absoluteNumber: e.absoluteNumber,
          title: e.title,
          airDate: e.airDate,
          aired: hasAired(e),
          monitored: e.monitored,
          file: file && {
            path: file.path,
            quality: QUALITY_NAMES[file.quality as Quality] ?? file.quality,
            size: file.size,
          },
        }
      })
    },
    async update(id, patch) {
      series.update(id, patch)
    },
    async monitorSeason(id, season, monitored) {
      series.monitorSeason(id, season, monitored)
    },
    async monitorEpisode(episodeId, monitored) {
      series.monitorEpisodes([episodeId], monitored)
    },
    refresh: (id) => series.refresh(id),
    async remove(id, deleteFiles) {
      series.remove(id, deleteFiles)
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/series', '/series/add', '/series/:id'],
    },
    data,
  )
}
