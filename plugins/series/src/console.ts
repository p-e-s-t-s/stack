// Web console entry: Series, Add series and Series detail pages.

import type {} from '@magpiejs/webui'
import type { MetadataSearchResult, Protocol } from '@magpiejs/types'
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
  download?: { state: string; progress: number }
}

export interface ReleaseRow {
  guid: string
  title: string
  indexer: string
  protocol: Protocol
  size?: number
  seeders?: number
  leechers?: number
  publishedAt?: string
  infoUrl?: string
  /** e.g. `S01E02`, `Season 1`. */
  unit: string
  quality: string
  formatScore: number
  matchedFormats: string[]
  accepted: boolean
  rejections: { rule: string; reason: string }[]
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
  /** Interactive search for these episodes. */
  search(
    id: number,
    episodeIds: number[],
  ): Promise<{ results: ReleaseRow[]; errors: { indexer: string; message: string }[] }>
  grab(id: number, guid: string): Promise<void>
  /** Automatic search and grab (the wanted episodes when none are given). Says what happened. */
  searchNow(id: number, episodeIds?: number[]): Promise<string>
}

/** `S01E02`, `S01E02-E03`, `Season 1`, `Seasons 1-2` for the episodes a release covers. */
function describe(episodes: { season: number; number: number }[]) {
  if (!episodes.length) return ''
  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b)
  if (episodes.length > 3 || seasons.length > 1)
    return seasons.length > 1 ? `Seasons ${seasons[0]}-${seasons.at(-1)}` : `Season ${seasons[0]}`
  const pad = (n: number) => String(n).padStart(2, '0')
  const numbers = episodes.map((e) => e.number).sort((a, b) => a - b)
  return `S${pad(seasons[0]!)}E${numbers.map(pad).join('-E')}`
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
    profiles: ctx.decision.profiles('video').map((p) => ({ id: p.id, name: p.name })),
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
      const downloads = new Map<number, { state: string; progress: number }>()
      for (const grab of series.activeGrabs(id))
        for (const episodeId of grab.unitIds)
          downloads.set(episodeId, { state: grab.state, progress: grab.progress })
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
            quality: ctx.decision.qualityName(file.quality),
            size: file.size,
          },
          download: downloads.get(e.id),
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
    async search(id, episodeIds) {
      const { results, errors } = await series.search(id, episodeIds, 'interactive')
      const episodes = new Map(series.episodes(id).map((e) => [e.id, e]))
      return {
        errors,
        results: results.map(({ release: r, decision: d, unitIds: covered }) => ({
          guid: r.guid,
          title: r.title,
          indexer: r.indexerName,
          protocol: r.protocol,
          size: r.size,
          seeders: r.seeders,
          leechers: r.leechers,
          publishedAt: r.publishedAt,
          infoUrl: r.infoUrl,
          unit: describe(covered.map((e) => episodes.get(e)!).filter(Boolean)),
          quality: ctx.decision.qualityName(d.quality),
          formatScore: d.formatScore,
          matchedFormats: d.matchedFormats,
          accepted: d.accepted,
          rejections: d.rejections.map(({ rule, reason }) => ({ rule, reason })),
        })),
      }
    },
    async grab(id, guid) {
      await series.grab(id, guid)
    },
    async searchNow(id, episodeIds) {
      const grabbed = await series.searchAndGrab(id, episodeIds)
      if (grabbed.length) return `Sent ${grabbed.join(', ')} to the download client.`
      if (!episodeIds && !series.wantedEpisodes(id).length)
        return 'Nothing is missing: every monitored, aired episode has a file.'
      return 'No acceptable release found. Use "Choose" to see why.'
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
