// Web console entry: Movies, Add movie and Movie detail pages.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import type {} from '@magpiejs/metadata'
import type {} from '@magpiejs/webui'
import type { MetadataSearchResult, Protocol } from '@magpiejs/types'
import type { Context } from 'cordis'
import { cutoffMet } from '@magpiejs/decision'
import { QUALITY_NAMES } from '@magpiejs/decision/qualities'
import { isAvailable, type Movie, type MoviesService } from './index'
import type { MinimumAvailability } from './schema'

export interface DownloadState {
  state: string
  progress: number
}

export interface MovieSummary {
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
  imdbId: string | null
  runtimeMinutes: number | null
  inCinemas: string | null
  digitalRelease: string | null
  physicalRelease: string | null
  minimumAvailability: MinimumAvailability
  available: boolean
  genres: string[]
  file?: { path: string; size: number; quality: string; releaseName: string | null }
  download?: DownloadState
}

/** What still has to be set up before movies can be found and downloaded. */
export interface SetupState {
  metadata: boolean
  rootFolder: boolean
  indexer: boolean
  client: boolean
}

export interface MoviesData {
  movies: MovieSummary[]
  setup: SetupState
  profiles: { id: number; name: string }[]
  rootFolders: { id: number; path: string }[]
  lookup(term: string): Promise<(MetadataSearchResult & { libraryId?: number })[]>
  add(options: {
    tmdbId: number
    profileId: number
    rootFolderId: number
    minimumAvailability: MinimumAvailability
    search: boolean
  }): Promise<number>
  update(
    id: number,
    patch: { profileId?: number; monitored?: boolean; minimumAvailability?: MinimumAvailability },
  ): Promise<void>
  remove(id: number, deleteFiles: boolean): Promise<void>
  refresh(id: number): Promise<void>
  grab(id: number, guid: string): Promise<void>
  /** Automatic search: grabs the best release. Says what happened. */
  searchNow(id: number): Promise<string>
  search(
    id: number,
  ): Promise<{ results: ReleaseRow[]; errors: { indexer: string; message: string }[] }>
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
  quality: string
  formatScore: number
  matchedFormats: string[]
  accepted: boolean
  rejections: { rule: string; reason: string }[]
}

function summarize(m: Movie): MovieSummary {
  const d = m.details
  return {
    id: m.id,
    title: m.title,
    year: m.year,
    overview: m.overview,
    posterUrl: m.posterUrl,
    monitored: m.monitored,
    profileId: m.profileId,
    rootFolderId: m.rootFolderId,
    folder: m.folder,
    tmdbId: d.tmdbId,
    imdbId: d.imdbId,
    runtimeMinutes: d.runtimeMinutes,
    inCinemas: d.inCinemas,
    digitalRelease: d.digitalRelease,
    physicalRelease: d.physicalRelease,
    minimumAvailability: d.minimumAvailability,
    available: isAvailable(d),
    genres: d.genres ?? [],
    file: m.file && {
      path: m.file.path,
      size: m.file.size,
      quality: m.file.quality,
      releaseName: m.file.releaseName,
    },
  }
}

export default function console_(ctx: Context, movies: MoviesService) {
  // live download state per movie, from the downloads plugin's events
  const downloads = new Map<number, DownloadState>()
  const ACTIVE = [
    'grabbed',
    'queued',
    'downloading',
    'paused',
    'stalled',
    'import_pending',
    'importing',
  ]
  const track = (grab: { mediaId: number; state: string; progress: number }) => {
    if (ACTIVE.includes(grab.state))
      downloads.set(grab.mediaId, { state: grab.state, progress: grab.progress })
    else downloads.delete(grab.mediaId)
  }
  ctx.inject(['downloads'], (ctx) => {
    for (const grab of ctx.downloads.active()) track(grab)
    refresh()
    ctx.effect(() => () => {
      downloads.clear()
      refresh()
    })
  })
  for (const event of ['downloads/grabbed', 'downloads/updated'] as const) {
    ctx.on(event, (grab) => {
      track(grab)
      refresh()
    })
  }

  const setup = (): SetupState => ({
    metadata: !!ctx.metadata.for('movie'),
    rootFolder: ctx.library.rootFolders('movie').length > 0,
    indexer: !!ctx.get('indexers')?.usable('automatic').length,
    client: !!ctx.get('downloads')?.listClients().length,
  })

  const snapshot = () => ({
    setup: setup(),
    movies: movies.list().map((m) => ({ ...summarize(m), download: downloads.get(m.id) })),
    profiles: ctx.decision.profiles().map((p) => ({ id: p.id, name: p.name })),
    rootFolders: ctx.library.rootFolders('movie').map((f) => ({ id: f.id, path: f.path })),
  })
  const refresh = ctx.debounce(() => entry.mutate((d) => Object.assign(d, snapshot())), 100)
  for (const event of [
    'library/added',
    'library/updated',
    'library/deleted',
    'library/file-added',
    'library/file-removed',
    'library/root-folders',
    'metadata/providers',
    'indexers/changed',
    'downloads/clients',
  ] as const) {
    ctx.on(event, refresh)
  }

  const data: MoviesData = {
    ...snapshot(),
    lookup: (term) => movies.lookup(term),
    async add(options) {
      const movie = await movies.add(options)
      return movie.id
    },
    async update(id, patch) {
      movies.update(id, patch)
    },
    async remove(id, deleteFiles) {
      movies.remove(id, deleteFiles)
    },
    refresh: (id) => movies.refresh(id),
    async grab(id, guid) {
      await movies.grab(id, guid)
    },
    async searchNow(id) {
      if (!movies.searchAndGrab) throw new Error('set up an indexer and a download client first')
      const movie = movies.get(id)
      const profile = movie && ctx.decision.profile(movie.profileId)
      if (movie?.file && profile && cutoffMet(profile, movie.file))
        return 'The file already meets the quality profile, so there is nothing to upgrade.'
      const grab = await movies.searchAndGrab(id, true)
      return grab
        ? `Sent ${grab.title} to the download client.`
        : 'No acceptable release found. Use "Choose a release" to see why.'
    },
    async search(id) {
      const { results, errors } = await movies.search(id, 'interactive')
      return {
        errors,
        results: results.map(({ release: r, decision: d }) => ({
          guid: r.guid,
          title: r.title,
          indexer: r.indexerName,
          protocol: r.protocol,
          size: r.size,
          seeders: r.seeders,
          leechers: r.leechers,
          publishedAt: r.publishedAt,
          infoUrl: r.infoUrl,
          quality: QUALITY_NAMES[d.quality] ?? d.quality,
          formatScore: d.formatScore,
          matchedFormats: d.matchedFormats,
          accepted: d.accepted,
          rejections: d.rejections.map(({ rule, reason }) => ({ rule, reason })),
        })),
      }
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/movies', '/movies/add', '/movie/:id'],
    },
    data,
  )
}
