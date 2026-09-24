// @magpiejs/music: artists, their albums and tracks. An artist is a library item (kind `music`)
// and their albums — MusicBrainz release groups of every type — are its units; which types are
// wanted is set per artist (studio albums and EPs by default). Track lists are fetched when an
// album is searched, imported or opened. Searching, downloading and importing are added by the
// parts of this plugin that need those services.

import { rmSync } from 'node:fs'
import type {} from '@cordisjs/plugin-timer'
import type { Drizzle } from '@magpiejs/database'
import { cutoffMet, profileRanks } from '@magpiejs/decision'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import { type MediaFile, type MediaItem, renderName } from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import type { AlbumMetadata } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { eq, inArray } from 'drizzle-orm'
import api from './api'
import automation from './automation'
import albumCalendar from './calendar'
import console_ from './console'
import { audioFamily } from './families'
import albumImport from './import'
import { MUSIC_NAMING } from './naming'
import * as schema from './schema'
import albumSearch, { type AlbumResult, type AlbumSearch } from './search'

export * from './families'
export { AUDIO_EXTENSIONS, readTags } from './import'
export * from './match'
export * from './parse'
export * from './schema'
export type { AlbumResult, AlbumSearch, FoundRelease } from './search'

declare module '@magpiejs/types' {
  interface MediaKinds {
    music: true
  }
}

declare module 'cordis' {
  interface Context {
    music: MusicService
  }
  interface Events {
    'music/added'(artist: Artist, options: { search: boolean }): void
    /** An artist's albums, tracks, monitoring, files or downloads changed. */
    'music/changed'(mediaId: number): void
  }
}

export interface ArtistStats {
  albums: number
  /** Monitored, released albums. */
  wanted: number
  /** Of those, how many have every track. */
  complete: number
  nextRelease?: string
}

export interface Artist extends MediaItem {
  details: schema.ArtistDetails
  stats: ArtistStats
}

export interface AddArtistOptions {
  /** MusicBrainz artist id. */
  artistId: string
  profileId: number
  rootFolderId: number
  monitor?: schema.MonitorOption
  albumTypes?: string[]
  secondaryTypes?: string[]
  search?: boolean
}

export const DEFAULT_ALBUM_TYPES = ['Album', 'EP']
export const PRIMARY_TYPES = ['Album', 'EP', 'Single', 'Broadcast', 'Other']
export const SECONDARY_TYPES = [
  'Compilation',
  'Soundtrack',
  'Spokenword',
  'Interview',
  'Audiobook',
  'Audio drama',
  'Live',
  'Remix',
  'DJ-mix',
  'Mixtape/Street',
  'Demo',
  'Field recording',
]

const DAY = 86_400_000
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/** Out already: `2007-10-10`, `2007-10` and `2007` all compare as strings against today. */
export const isReleased = (album: { releaseDate: string | null }, now = Date.now()) =>
  !!album.releaseDate && album.releaseDate <= today(now)

/** Whether an album is of a type the artist is followed for. */
export function isWantedType(
  album: { primaryType: string | null; secondaryTypes: string[] },
  artist: { albumTypes: string[]; secondaryTypes: string[] },
) {
  return (
    !!album.primaryType &&
    artist.albumTypes.includes(album.primaryType) &&
    album.secondaryTypes.every((t) => artist.secondaryTypes.includes(t))
  )
}

function albumValues(a: AlbumMetadata) {
  return {
    title: a.title,
    primaryType: a.primaryType ?? null,
    secondaryTypes: a.secondaryTypes,
    releaseDate: a.releaseDate ?? null,
    coverUrl: a.coverUrl ?? null,
  }
}

/** Oldest first; albums without a date last. */
export const byRelease = (a: schema.Album, b: schema.Album) =>
  (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') || a.id - b.id

export class MusicService extends Service {
  static inject = ['database', 'library', 'metadata', 'jobs', 'decision', 'timer']

  db!: Drizzle<typeof schema>
  /** Set while an indexers plugin is loaded. */
  searcher?: AlbumSearch
  /** Set while a downloads plugin is loaded. */
  grabber?: (mediaId: number, result: AlbumResult, manual: boolean) => Promise<unknown>

  constructor(ctx: Context) {
    super(ctx, 'music')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'music',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.library.registerKind({ id: 'music', label: 'Music' })
    this.ctx.library.registerNaming('music', MUSIC_NAMING)
    this.ctx.decision.family(audioFamily)
    this.ctx.jobs.define('music.refresh', async (payload: { id?: number }) => {
      const ids = payload?.id ? [payload.id] : this.list().map((a) => a.id)
      for (const id of ids) {
        try {
          await this.refresh(id)
        } catch (error) {
          this.ctx.logger.warn('could not refresh artist %s: %s', id, error)
        }
      }
    })
    this.ctx.jobs.schedule('music.refresh-all', 'music.refresh', DAY)
    this.ctx.inject(['indexers'], (ctx) => void ctx.plugin(albumSearch, this))
    this.ctx.inject(['import'], (ctx) => void ctx.plugin(albumImport, this))
    this.ctx.inject(['indexers', 'downloads'], (ctx) => void ctx.plugin(automation, this))
    this.ctx.inject(['calendar'], (ctx) => void ctx.plugin(albumCalendar, this))
    this.ctx.inject(['api'], (ctx) => void ctx.plugin(api, this))
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    this.ctx.inject(['downloads'], (ctx) => {
      ctx.effect(() => {
        this.grabber = async (mediaId, { release, decision, albumIds }, manual) => {
          const grab = await ctx.downloads.grab(mediaId, release, {
            quality: decision.quality,
            formatScore: decision.formatScore,
            manual,
          })
          if (albumIds.length)
            this.db
              .insert(schema.grabAlbums)
              .values(albumIds.map((albumId) => ({ grabId: grab.id, albumId })))
              .run()
          this.ctx.emit('music/changed', mediaId)
          return grab
        }
        return () => (this.grabber = undefined)
      }, 'music.grabber')

      // a release isn't wanted while an equal or better one of the album is downloading
      ctx.decision.rule('album-in-queue', ({ target, qualityRank, formatScore, rankOf }) => {
        if (target.kind !== 'album' || !target.mediaId || !target.unitIds?.length) return
        for (const grab of this.activeGrabs(target.mediaId)) {
          if (!grab.albumIds.some((id) => target.unitIds!.includes(id))) continue
          const rank = rankOf(grab.quality)
          if (rank > qualityRank || (rank === qualityRank && grab.formatScore >= formatScore))
            return `already downloading ${grab.title}`
        }
      })
      for (const event of ['downloads/grabbed', 'downloads/updated'] as const)
        ctx.on(event, (grab) => {
          if (this.get(grab.mediaId)) this.ctx.emit('music/changed', grab.mediaId)
        })
    })
  }

  provider() {
    const provider = this.ctx.get('metadata')?.for('music', 'musicbrainz')
    if (!provider?.getArtist || !provider.getAlbums || !provider.getTracks)
      throw new Error('no music metadata provider is enabled (add MusicBrainz in Settings)')
    return provider
  }

  // ---- finding and adding artists

  /** Searches for artists; results already in the library carry their library id. */
  async lookup(term: string) {
    const results = await this.provider().search({ term, kind: 'music' })
    const existing = new Map(
      this.db
        .select()
        .from(schema.artists)
        .all()
        .map((a) => [a.musicbrainzId, a.mediaId]),
    )
    return results.map((r) => ({ ...r, libraryId: existing.get(r.ids.musicbrainz ?? '') }))
  }

  async add(options: AddArtistOptions): Promise<Artist> {
    if (this.ctx.decision.profile(options.profileId)?.family !== 'audio')
      throw new Error('choose an audio quality profile')
    const found = this.db
      .select()
      .from(schema.artists)
      .where(eq(schema.artists.musicbrainzId, options.artistId))
      .get()
    if (found) throw new Error('this artist is already in the library')
    const provider = this.provider()
    const meta = await provider.getArtist!(options.artistId)
    const albums = await provider.getAlbums!(options.artistId)
    const types = {
      albumTypes: options.albumTypes ?? DEFAULT_ALBUM_TYPES,
      secondaryTypes: options.secondaryTypes ?? [],
    }
    const monitor = options.monitor ?? 'all'
    const naming = this.ctx.library.naming('music')
    const item = this.ctx.library.add(
      {
        kind: 'music',
        title: meta.title,
        overview: meta.overview ?? null,
        posterUrl: null,
        monitored: monitor !== 'none',
        externalIds: { musicbrainz: options.artistId },
        primaryProvider: 'musicbrainz',
        profileId: options.profileId,
        rootFolderId: options.rootFolderId,
        folder: renderName(naming.artistFolder!, { 'Artist Name': meta.title }),
        refreshedAt: Date.now(),
      },
      meta.alternateNames,
    )
    const wanted = albums.filter((a) =>
      isWantedType({ primaryType: a.primaryType ?? null, secondaryTypes: a.secondaryTypes }, types),
    )
    const released = wanted
      .filter((a) => isReleased({ releaseDate: a.releaseDate ?? null }))
      .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''))
    const latest = released.at(-1)
    const monitored = (a: AlbumMetadata) =>
      wanted.includes(a) &&
      (monitor === 'all' ||
        ((monitor === 'future' || monitor === 'latest') &&
          !isReleased({ releaseDate: a.releaseDate ?? null })) ||
        (monitor === 'latest' && a === latest))
    this.db.transaction((tx) => {
      tx.insert(schema.artists)
        .values({
          mediaId: item.id,
          musicbrainzId: options.artistId,
          artistType: meta.artistType ?? null,
          disambiguation: meta.disambiguation ?? null,
          country: meta.country ?? null,
          ...types,
          monitorNew: monitor !== 'none',
        })
        .run()
      for (const a of albums)
        tx.insert(schema.albums)
          .values({
            mediaId: item.id,
            musicbrainzId: a.ids.musicbrainz!,
            ...albumValues(a),
            monitored: monitored(a),
          })
          .onConflictDoNothing()
          .run()
    })
    const artist = this.get(item.id)!
    this.ctx.emit('music/added', artist, { search: options.search ?? true })
    return artist
  }

  /** Updates an artist and their albums from the provider; new albums of wanted types are monitored. */
  async refresh(mediaId: number) {
    const artist = this.get(mediaId)
    if (!artist) return
    const provider = this.provider()
    const [meta, fresh] = await Promise.all([
      provider.getArtist!(artist.details.musicbrainzId),
      provider.getAlbums!(artist.details.musicbrainzId),
    ])
    const known = new Map(this.albums(mediaId).map((a) => [a.musicbrainzId, a]))
    const withFiles = new Set(
      this.albums(mediaId)
        .filter((a) => this.trackFiles(a.id).size)
        .map((a) => a.id),
    )
    this.db.transaction((tx) => {
      tx.update(schema.artists)
        .set({
          artistType: meta.artistType ?? null,
          disambiguation: meta.disambiguation ?? null,
          country: meta.country ?? null,
        })
        .where(eq(schema.artists.mediaId, mediaId))
        .run()
      for (const a of fresh) {
        const old = known.get(a.ids.musicbrainz!)
        known.delete(a.ids.musicbrainz!)
        if (old) {
          tx.update(schema.albums).set(albumValues(a)).where(eq(schema.albums.id, old.id)).run()
          continue
        }
        const monitored =
          artist.monitored &&
          artist.details.monitorNew &&
          isWantedType(
            { primaryType: a.primaryType ?? null, secondaryTypes: a.secondaryTypes },
            artist.details,
          )
        tx.insert(schema.albums)
          .values({ mediaId, musicbrainzId: a.ids.musicbrainz!, ...albumValues(a), monitored })
          .run()
      }
      // albums MusicBrainz dropped (merged, deleted) go too, unless they have files
      const gone = [...known.values()].filter((a) => !withFiles.has(a.id)).map((a) => a.id)
      if (gone.length) tx.delete(schema.albums).where(inArray(schema.albums.id, gone)).run()
    })
    this.ctx.library.update(
      mediaId,
      { title: meta.title, overview: meta.overview ?? null, refreshedAt: Date.now() },
      meta.alternateNames,
    )
    this.ctx.emit('music/changed', mediaId)
  }

  /** The album's tracks, fetched from the provider the first time they're needed. */
  async ensureTracks(albumId: number) {
    const album = this.album(albumId)
    if (!album) throw new Error(`album ${albumId} not found`)
    const existing = this.tracks(albumId)
    if (album.releaseId && existing.length) return existing
    const list = await this.provider().getTracks!(album.musicbrainzId)
    this.db.transaction((tx) => {
      tx.update(schema.albums)
        .set({ releaseId: list.releaseId })
        .where(eq(schema.albums.id, albumId))
        .run()
      const known = new Map(existing.map((t) => [`${t.disc}.${t.number}`, t]))
      for (const disc of list.discs)
        for (const t of disc.tracks) {
          const values = {
            title: t.title,
            lengthMs: t.lengthMs ?? null,
            recordingId: t.recordingId ?? null,
          }
          const old = known.get(`${disc.number}.${t.number}`)
          if (old) tx.update(schema.tracks).set(values).where(eq(schema.tracks.id, old.id)).run()
          else
            tx.insert(schema.tracks)
              .values({ albumId, disc: disc.number, number: t.number, ...values })
              .run()
        }
    })
    this.ctx.emit('music/changed', album.mediaId)
    return this.tracks(albumId)
  }

  // ---- reading

  get(mediaId: number): Artist | undefined {
    const item = this.ctx.library.get(mediaId)
    if (!item || item.kind !== 'music') return
    const details = this.db
      .select()
      .from(schema.artists)
      .where(eq(schema.artists.mediaId, mediaId))
      .get()
    if (!details) return
    return { ...item, details, stats: this.stats(mediaId) }
  }

  list(): Artist[] {
    const details = new Map(
      this.db
        .select()
        .from(schema.artists)
        .all()
        .map((d) => [d.mediaId, d]),
    )
    return this.ctx.library
      .list('music')
      .filter((item) => details.has(item.id))
      .map((item) => ({ ...item, details: details.get(item.id)!, stats: this.stats(item.id) }))
  }

  stats(mediaId: number, now = Date.now()): ArtistStats {
    const albums = this.albums(mediaId)
    const wanted = albums.filter((a) => a.monitored && isReleased(a, now))
    const upcoming = albums
      .filter((a) => a.monitored && a.releaseDate && a.releaseDate > today(now))
      .map((a) => a.releaseDate!)
      .sort()
    return {
      albums: albums.length,
      wanted: wanted.length,
      complete: wanted.filter((a) => this.isComplete(a.id)).length,
      nextRelease: upcoming[0],
    }
  }

  /** All of an artist's albums, newest first. */
  albums(mediaId: number) {
    return this.db
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.mediaId, mediaId))
      .all()
      .sort((a, b) => byRelease(b, a))
  }

  album(id: number) {
    return this.db.select().from(schema.albums).where(eq(schema.albums.id, id)).get()
  }

  tracks(albumId: number) {
    return this.db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.albumId, albumId))
      .orderBy(schema.tracks.disc, schema.tracks.number)
      .all()
  }

  /** Files of an album by track id. */
  trackFiles(albumId: number): Map<number, MediaFile> {
    const tracks = this.tracks(albumId)
    if (!tracks.length) return new Map()
    const links = this.db
      .select()
      .from(schema.trackFiles)
      .where(
        inArray(
          schema.trackFiles.trackId,
          tracks.map((t) => t.id),
        ),
      )
      .all()
    if (!links.length) return new Map()
    const album = this.album(albumId)!
    const files = new Map(this.ctx.library.files(album.mediaId).map((f) => [f.id, f]))
    return new Map(
      links.filter((l) => files.has(l.fileId)).map((l) => [l.trackId, files.get(l.fileId)!]),
    )
  }

  /** Every track has a file (tracks must be known). */
  isComplete(albumId: number) {
    const tracks = this.tracks(albumId)
    return tracks.length > 0 && this.trackFiles(albumId).size === tracks.length
  }

  /** The album's weakest file, which is what an upgrade must beat. */
  worstFile(albumId: number, profileId: number) {
    const files = [...this.trackFiles(albumId).values()]
    const profile = this.ctx.decision.profile(profileId)
    const rankOf = profile ? profileRanks(profile).rankOf : () => 0
    return files.sort(
      (a, b) => rankOf(a.quality) - rankOf(b.quality) || a.formatScore - b.formatScore,
    )[0]
  }

  /** Monitored, released albums that are incomplete, or below the profile's cutoff. */
  wantedAlbums(mediaId: number, now = Date.now()) {
    const artist = this.get(mediaId)
    if (!artist) return []
    const profile = this.ctx.decision.profile(artist.profileId)
    return this.albums(mediaId).filter((a) => {
      if (!a.monitored || !isReleased(a, now)) return false
      if (!this.isComplete(a.id)) return true
      const worst = this.worstFile(a.id, artist.profileId)
      return !!worst && !!profile && !cutoffMet(profile, worst)
    })
  }

  /** Links an imported file to its track (replacing an earlier file of that track). */
  linkTrackFile(fileId: number, trackId: number) {
    this.db.transaction((tx) => {
      tx.delete(schema.trackFiles).where(eq(schema.trackFiles.trackId, trackId)).run()
      tx.insert(schema.trackFiles).values({ fileId, trackId }).run()
    })
  }

  /** Downloads in progress for an artist, with the albums each is. */
  activeGrabs(mediaId: number) {
    const active =
      this.ctx
        .get('downloads')
        ?.active()
        .filter((g) => g.mediaId === mediaId) ?? []
    if (!active.length) return []
    const links = this.db
      .select()
      .from(schema.grabAlbums)
      .where(
        inArray(
          schema.grabAlbums.grabId,
          active.map((g) => g.id),
        ),
      )
      .all()
    return active.map((grab) => ({
      ...grab,
      albumIds: links.filter((l) => l.grabId === grab.id).map((l) => l.albumId),
    }))
  }

  grabAlbums(grabId: number) {
    return this.db
      .select()
      .from(schema.grabAlbums)
      .where(eq(schema.grabAlbums.grabId, grabId))
      .all()
      .map((l) => l.albumId)
  }

  // ---- changing

  update(
    mediaId: number,
    patch: {
      profileId?: number
      monitored?: boolean
      monitorNew?: boolean
      albumTypes?: string[]
      secondaryTypes?: string[]
    },
  ) {
    const { monitorNew, albumTypes, secondaryTypes, ...itemPatch } = patch
    if (
      itemPatch.profileId !== undefined &&
      this.ctx.decision.profile(itemPatch.profileId)?.family !== 'audio'
    )
      throw new Error('choose an audio quality profile')
    if (monitorNew !== undefined || albumTypes || secondaryTypes)
      this.db
        .update(schema.artists)
        .set({ monitorNew, albumTypes, secondaryTypes })
        .where(eq(schema.artists.mediaId, mediaId))
        .run()
    this.ctx.library.update(mediaId, itemPatch)
    this.ctx.emit('music/changed', mediaId)
    return this.get(mediaId)
  }

  monitorAlbums(albumIds: number[], monitored: boolean) {
    if (!albumIds.length) return
    const rows = this.db
      .update(schema.albums)
      .set({ monitored })
      .where(inArray(schema.albums.id, albumIds))
      .returning()
      .all()
    for (const mediaId of new Set(rows.map((r) => r.mediaId)))
      this.ctx.emit('music/changed', mediaId)
  }

  markSearched(albumIds: number[], now = Date.now()) {
    if (!albumIds.length) return
    this.db
      .update(schema.albums)
      .set({ lastSearchedAt: now })
      .where(inArray(schema.albums.id, albumIds))
      .run()
  }

  remove(mediaId: number, deleteFiles = false) {
    const artist = this.get(mediaId)
    if (!artist) return
    if (deleteFiles) rmSync(this.ctx.library.folderOf(artist), { recursive: true, force: true })
    this.ctx.library.remove(mediaId)
  }

  // ---- searching and grabbing

  search(mediaId: number, albumIds: number[], kind: 'automatic' | 'interactive' = 'automatic') {
    if (!this.searcher) throw new Error('no indexers are enabled')
    return this.searcher.search(mediaId, albumIds, kind)
  }

  async grab(mediaId: number, guid: string) {
    const result = this.searcher?.cached(mediaId, guid)
    if (!result) throw new Error('search results expired; search again')
    if (!this.grabber) throw new Error('no download clients are enabled')
    return this.grabber(mediaId, result, true)
  }

  /** Searches for albums (the wanted ones when not given) and grabs the best release of each. */
  async searchAndGrab(mediaId: number, albumIds?: number[]) {
    if (!this.grabber) throw new Error('set up a download client first')
    const ids = albumIds ?? this.wantedAlbums(mediaId).map((a) => a.id)
    if (!ids.length) return []
    const { results } = await this.search(mediaId, ids)
    const grabbed: string[] = []
    for (const result of pickReleases(results, new Set(ids))) {
      await this.grabber(mediaId, result, false)
      grabbed.push(result.release.title)
    }
    return grabbed
  }
}

/** The best accepted release of each wanted album. */
export function pickReleases(results: AlbumResult[], wanted: Set<number>) {
  const picked: AlbumResult[] = []
  const covered = new Set<number>()
  for (const r of results) {
    if (!r.decision.accepted) continue
    if (!r.albumIds.some((id) => wanted.has(id)) || r.albumIds.some((id) => covered.has(id)))
      continue
    picked.push(r)
    for (const id of r.albumIds) covered.add(id)
  }
  return picked
}

export default MusicService
