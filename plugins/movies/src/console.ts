// Web console entry: Movies, Add movie and Movie detail pages.

import type {} from '@magpiejs/webui'
import type { MetadataSearchResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import { isAvailable, type Movie, type MoviesService } from './index'
import type { MinimumAvailability } from './schema'

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
}

export interface MoviesData {
  movies: MovieSummary[]
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
  const snapshot = () => ({
    movies: movies.list().map(summarize),
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
