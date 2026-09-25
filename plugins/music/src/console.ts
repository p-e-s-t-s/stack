// Web console entry: Music (artists), Add artist, Artist detail (albums by type) and Album
// detail (tracks) pages.

import type {} from '@magpiejs/webui'
import type { MetadataSearchResult, Protocol } from '@magpiejs/types'
import type { Context } from 'cordis'
import {
  type Artist,
  type ArtistStats,
  byRelease,
  isReleased,
  isWantedType,
  type MusicService,
  PRIMARY_TYPES,
  SECONDARY_TYPES,
} from './index'
import type { Album, MonitorOption } from './schema'

export interface ArtistSummary {
  id: number
  title: string
  overview: string | null
  /** The newest album's cover (MusicBrainz has no artist pictures). */
  posterUrl: string | null
  monitored: boolean
  monitorNew: boolean
  profileId: number
  rootFolderId: number
  folder: string
  albumTypes: string[]
  secondaryTypes: string[]
  stats: ArtistStats
}

export interface AlbumRow {
  id: number
  title: string
  primaryType: string | null
  secondaryTypes: string[]
  releaseDate: string | null
  coverUrl: string | null
  monitored: boolean
  released: boolean
  /** Of a type the artist is followed for. */
  wantedType: boolean
  /** Null until the track list has been fetched. */
  tracks: number | null
  files: number
  quality?: string
  download?: { state: string; progress: number }
}

export interface TrackRow {
  id: number
  disc: number
  number: number
  title: string
  lengthMs: number | null
  file?: { path: string; quality: string; size: number }
}

export interface ReleaseRow {
  guid: string
  title: string
  indexer: string
  protocol: Protocol
  size?: number
  seeders?: number
  leechers?: number
  unit: string
  quality: string
  formatScore: number
  matchedFormats: string[]
  accepted: boolean
  rejections: { rule: string; reason: string }[]
}

export interface MusicData {
  artists: ArtistSummary[]
  profiles: { id: number; name: string }[]
  rootFolders: { id: number; path: string }[]
  primaryTypes: string[]
  secondaryTypes: string[]
  /** Bumped per artist when their albums, tracks, files or downloads change. */
  revision: Record<number, number>
  lookup(term: string): Promise<(MetadataSearchResult & { libraryId?: number })[]>
  add(options: {
    artistId: string
    profileId: number
    rootFolderId: number
    monitor: MonitorOption
    albumTypes: string[]
    secondaryTypes: string[]
    search: boolean
  }): Promise<number>
  albums(id: number): Promise<AlbumRow[]>
  /** An album with its tracks (fetched from MusicBrainz the first time). */
  album(albumId: number): Promise<{ album: AlbumRow; tracks: TrackRow[] }>
  update(
    id: number,
    patch: {
      profileId?: number
      monitored?: boolean
      monitorNew?: boolean
      albumTypes?: string[]
      secondaryTypes?: string[]
    },
  ): Promise<void>
  monitorAlbum(albumId: number, monitored: boolean): Promise<void>
  refresh(id: number): Promise<void>
  remove(id: number, deleteFiles: boolean): Promise<void>
  search(
    id: number,
    albumIds: number[],
  ): Promise<{ results: ReleaseRow[]; errors: { indexer: string; message: string }[] }>
  grab(id: number, guid: string): Promise<void>
  /** Automatic search and grab (the wanted albums when none are given). Says what happened. */
  searchNow(id: number, albumIds?: number[]): Promise<string>
}

export default function console_(ctx: Context, music: MusicService) {
  const summaries = (): ArtistSummary[] =>
    music.list().map((a) => {
      const covered = music
        .albums(a.id)
        .filter((x) => x.coverUrl && isWantedType(x, a.details) && isReleased(x))
      return {
        id: a.id,
        title: a.title,
        overview: a.overview,
        posterUrl: covered[0]?.coverUrl ?? null,
        monitored: a.monitored,
        monitorNew: a.details.monitorNew,
        profileId: a.profileId,
        rootFolderId: a.rootFolderId,
        folder: a.folder,
        albumTypes: a.details.albumTypes,
        secondaryTypes: a.details.secondaryTypes,
        stats: a.stats,
      }
    })

  const snapshot = () => ({
    artists: summaries(),
    profiles: ctx.decision.profiles('audio').map((p) => ({ id: p.id, name: p.name })),
    rootFolders: ctx.library.rootFolders('music').map((f) => ({ id: f.id, path: f.path })),
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
  ctx.on('music/changed', (id) => touch(id))
  for (const event of ['library/added', 'library/updated', 'library/deleted'] as const)
    ctx.on(event, (item) => touch(item.id))
  for (const event of ['library/file-added', 'library/file-removed'] as const)
    ctx.on(event, (item) => touch(item.id))
  ctx.on('library/root-folders', () => touch())
  ctx.on('decision/families', () => touch())

  function albumRow(
    a: Album,
    artist: Artist,
    downloads: Map<number, { state: string; progress: number }>,
  ): AlbumRow {
    const tracks = music.tracks(a.id)
    const files = [...music.trackFiles(a.id).values()]
    const worst = files.length ? music.worstFile(a.id, artist.profileId) : undefined
    return {
      id: a.id,
      title: a.title,
      primaryType: a.primaryType,
      secondaryTypes: a.secondaryTypes,
      releaseDate: a.releaseDate,
      coverUrl: a.coverUrl,
      monitored: a.monitored,
      released: isReleased(a),
      wantedType: isWantedType(a, artist.details),
      tracks: a.releaseId ? tracks.length : null,
      files: files.length,
      quality: worst && ctx.decision.qualityName(worst.quality),
      download: downloads.get(a.id),
    }
  }

  const downloadsOf = (id: number) => {
    const map = new Map<number, { state: string; progress: number }>()
    for (const grab of music.activeGrabs(id))
      for (const albumId of grab.unitIds)
        map.set(albumId, { state: grab.state, progress: grab.progress })
    return map
  }

  const data: MusicData = {
    ...snapshot(),
    primaryTypes: PRIMARY_TYPES,
    secondaryTypes: SECONDARY_TYPES,
    revision: {},
    lookup: (term) => music.lookup(term),
    async add(options) {
      return (await music.add(options)).id
    },
    async albums(id) {
      const artist = music.get(id)
      if (!artist) return []
      const downloads = downloadsOf(id)
      return music
        .albums(id)
        .sort((a, b) => byRelease(b, a))
        .map((a) => albumRow(a, artist, downloads))
    },
    async album(albumId) {
      const album = music.album(albumId)
      if (!album) throw new Error('that album is no longer in the library')
      const tracks = await music.ensureTracks(albumId)
      const files = music.trackFiles(albumId)
      return {
        album: albumRow(
          music.album(albumId)!,
          music.get(album.mediaId)!,
          downloadsOf(album.mediaId),
        ),
        tracks: tracks.map((t) => {
          const file = files.get(t.id)
          return {
            id: t.id,
            disc: t.disc,
            number: t.number,
            title: t.title,
            lengthMs: t.lengthMs,
            file: file && {
              path: file.path,
              quality: ctx.decision.qualityName(file.quality),
              size: file.size,
            },
          }
        }),
      }
    },
    async update(id, patch) {
      music.update(id, patch)
    },
    async monitorAlbum(albumId, monitored) {
      music.monitorAlbums([albumId], monitored)
    },
    refresh: (id) => music.refresh(id),
    async remove(id, deleteFiles) {
      music.remove(id, deleteFiles)
    },
    async search(id, albumIds) {
      const { results, errors } = await music.search(id, albumIds, 'interactive')
      const titles = new Map(music.albums(id).map((a) => [a.id, a.title]))
      return {
        errors,
        results: results.map(({ release: r, decision: d, unitIds: ids }) => ({
          guid: r.guid,
          title: r.title,
          indexer: r.indexerName,
          protocol: r.protocol,
          size: r.size,
          seeders: r.seeders,
          leechers: r.leechers,
          unit: ids.map((x) => titles.get(x)).join(', '),
          quality: ctx.decision.qualityName(d.quality),
          formatScore: d.formatScore,
          matchedFormats: d.matchedFormats,
          accepted: d.accepted,
          rejections: d.rejections.map(({ rule, reason }) => ({ rule, reason })),
        })),
      }
    },
    async grab(id, guid) {
      await music.grab(id, guid)
    },
    async searchNow(id, albumIds) {
      const grabbed = await music.searchAndGrab(id, albumIds)
      if (grabbed.length) return `Sent ${grabbed.join(', ')} to the download client.`
      if (!albumIds && !music.wantedAlbums(id).length)
        return 'Nothing is missing: every monitored, released album is complete.'
      return 'No acceptable release found. Use "Choose" to see why.'
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/music', '/music/add', '/music/:id', '/music/:id/:albumId'],
    },
    data,
  )
}
