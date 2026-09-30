// Web console entry: Movies, Add movie and Movie detail pages.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import type {} from '@magpiejs/metadata'
import type {} from '@magpiejs/webui'
import type { MetadataSearchResult, Protocol } from '@magpiejs/types'
import type { Context } from 'cordis'
import { cutoffMet } from '@magpiejs/decision'
import { isAvailable, type Movie, type MoviesService } from './index'
import type { MinimumAvailability } from './schema'
import { movieDownloads } from './download-state'

export interface DownloadState {
  state: string
  progress: number
}

/** An extra version of a movie (the primary one is the movie itself). */
export interface VersionSummary {
  id: number
  name: string
  profileId: number
  monitored: boolean
  file?: { path: string; size: number; quality: string; releaseName: string | null }
  download?: DownloadState
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
  /** Extra versions; empty for a movie with one version. */
  versions: VersionSummary[]
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
  /** `targetId` is the version the release is for; absent is the primary one. */
  grab(id: number, guid: string, targetId?: number): Promise<void>
  addVersion(id: number, version: { name: string; profileId: number }): Promise<void>
  updateVersion(
    id: number,
    targetId: number,
    patch: { profileId?: number; monitored?: boolean },
  ): Promise<void>
  /** A version with a file needs `files`: keep it on disk or move it to the recycle bin. */
  removeVersion(id: number, targetId: number, files?: 'keep' | 'delete'): Promise<void>
  /** Automatic search: grabs the best release. Says what happened. */
  searchNow(id: number, targetId?: number): Promise<string>
  search(
    id: number,
    targetId?: number,
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

const fileOf = (file: Movie['file']) =>
  file && {
    path: file.path,
    size: file.size,
    quality: file.quality,
    releaseName: file.releaseName,
  }

function summarize(
  m: Movie,
  downloads: { primary?: DownloadState; versions: Map<number, DownloadState> } = {
    versions: new Map(),
  },
): MovieSummary {
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
    file: fileOf(m.file),
    download: downloads.primary,
    versions: m.targets.flatMap((t) =>
      t.id === null
        ? []
        : [
            {
              id: t.id,
              name: t.name!,
              profileId: t.profileId,
              monitored: t.monitored,
              file: fileOf(t.file),
              download: downloads.versions.get(t.id),
            },
          ],
    ),
  }
}

export default function console_(ctx: Context, movies: MoviesService) {
  ctx.inject(['downloads'], (ctx) => {
    refresh()
    ctx.effect(() => () => refresh())
  })
  for (const event of ['downloads/grabbed', 'downloads/updated'] as const) {
    ctx.on(event, () => refresh())
  }

  const setup = (): SetupState => ({
    metadata: !!ctx.metadata.for('movie'),
    rootFolder: ctx.library.rootFolders('movie').length > 0,
    indexer: !!ctx.get('indexers')?.usable('automatic').length,
    client: !!ctx.get('downloads')?.listClients().length,
  })

  const snapshot = () => {
    const active = ctx.get('downloads')?.active() ?? []
    // the movie's own download and each extra version's are shown separately
    const primary = movieDownloads(active.filter((g) => !g.targetId))
    const versions = new Map<number, Map<number, DownloadState>>()
    const extra = active
      .filter((g) => g.targetId)
      .sort((a, b) => a.grabbedAt - b.grabbedAt || a.id - b.id)
    for (const g of extra) {
      const byVersion = versions.get(g.mediaId) ?? new Map<number, DownloadState>()
      versions.set(g.mediaId, byVersion.set(g.targetId!, { state: g.state, progress: g.progress }))
    }
    return {
      setup: setup(),
      movies: movies
        .list()
        .map((m) =>
          summarize(m, { primary: primary.get(m.id), versions: versions.get(m.id) ?? new Map() }),
        ),
      profiles: ctx.decision.profiles('video').map((p) => ({ id: p.id, name: p.name })),
      rootFolders: ctx.library.rootFolders('movie').map((f) => ({ id: f.id, path: f.path })),
    }
  }
  const refresh = ctx.debounce(() => entry.mutate((d) => Object.assign(d, snapshot())), 100)
  for (const event of [
    'library/added',
    'library/updated',
    'library/deleted',
    'library/file-added',
    'library/file-removed',
    'library/root-folders',
    'movies/target-added',
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
    async grab(id, guid, targetId) {
      await movies.grab(id, guid, targetId)
    },
    async addVersion(id, version) {
      movies.addTarget(id, version)
    },
    async updateVersion(id, targetId, patch) {
      movies.updateTarget(id, targetId, patch)
    },
    async removeVersion(id, targetId, files) {
      await movies.removeTarget(id, targetId, files)
    },
    async searchNow(id, targetId) {
      if (!movies.searchAndGrab) throw new Error('set up an indexer and a download client first')
      const movie = movies.get(id)
      const version = movie && movies.targetOf(movie, targetId)
      const covered = movie?.targets.filter((t) => targetId === undefined || t === version) ?? []
      if (
        covered.length &&
        covered.every((t) => {
          const p = ctx.decision.profile(t.profileId)
          return t.file && p && cutoffMet(p, t.file)
        })
      )
        return covered.length > 1
          ? 'Every version already meets its quality profile, so there is nothing to upgrade.'
          : 'The file already meets the quality profile, so there is nothing to upgrade.'
      const grab = await movies.searchAndGrab(id, true, targetId)
      return grab
        ? `Sent ${grab.title} to the download client.`
        : 'No acceptable release found. Use "Choose a release" to see why.'
    },
    async search(id, targetId) {
      const { results, errors } = await movies.search(id, 'interactive', targetId)
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
          quality: ctx.decision.qualityName(d.quality),
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
