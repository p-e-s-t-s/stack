// @magpiejs/movies: the movie kind — adding movies from TMDB, availability, refresh, pages.
// Searching and downloading are done by other plugins listening to `movies/*` events.

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@cordisjs/plugin-timer'
import type {} from '@magpiejs/api'
import type {} from '@magpiejs/calendar'
import type {} from '@magpiejs/downloads'
import { recycle } from '@magpiejs/import'
import type {} from '@magpiejs/jobs'
import { type MediaFile, type MediaItem, renderName } from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import type { MovieMetadata } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import api from './api'
import movieCalendar from './calendar'
import console_ from './console'
import automation from './automation'
import movieImport from './import'
import { MOVIE_NAMING } from './naming'
import movieSearch, { type MovieSearch, type SearchResult } from './search'
import * as schema from './schema'

export * from './schema'
export { matchesMovie, targetFor, type MovieSearch, type SearchResult } from './search'

declare module 'cordis' {
  interface Context {
    movies: MoviesService
  }
  interface Events {
    'movies/added'(movie: Movie, options: { search: boolean }): void
    'movies/target-added'(movie: Movie, target: MovieTarget): void
  }
}

/**
 * One version of a movie: its own quality profile and file. The movie's own profile is the
 * primary target (`id` null); other targets are rows of `library_targets`.
 */
export interface MovieTarget {
  id: number | null
  /** The file-name suffix; null for the primary target. */
  name: string | null
  profileId: number
  monitored: boolean
  file?: MediaFile
}

export interface Movie extends MediaItem {
  details: schema.MovieDetails
  /** The primary target's file. */
  file?: MediaFile
  /** Every file, all targets. */
  files: MediaFile[]
  /** The primary target first, then the extra versions. */
  targets: MovieTarget[]
}

export interface AddMovieOptions {
  /** Existing folder relative to the root, used by library adoption. */
  folder?: string
  tmdbId: number
  profileId: number
  rootFolderId: number
  minimumAvailability?: schema.MinimumAvailability
  monitored?: boolean
  /** Search for it right away (handled by the indexers plugin). */
  search?: boolean
}

const DAY = 86_400_000

/** Whether a movie has reached its minimum availability (and should be searched). */
export function isAvailable(details: schema.MovieDetails, now = Date.now()) {
  const past = (date?: string | null) => !!date && Date.parse(date) <= now
  switch (details.minimumAvailability) {
    case 'announced':
      return true
    case 'inCinemas':
      return (
        past(details.inCinemas) || past(details.digitalRelease) || past(details.physicalRelease)
      )
    case 'released':
      if (past(details.digitalRelease) || past(details.physicalRelease)) return true
      // no home release date known: assume one 90 days after cinemas
      return (
        !details.digitalRelease &&
        !details.physicalRelease &&
        !!details.inCinemas &&
        Date.parse(details.inCinemas) + 90 * DAY <= now
      )
  }
}

function detailsFrom(meta: MovieMetadata) {
  return {
    tmdbId: Number(meta.ids.tmdb),
    imdbId: meta.ids.imdb ?? null,
    runtimeMinutes: meta.runtimeMinutes ?? null,
    originalLanguage: meta.originalLanguage ?? null,
    inCinemas: meta.releaseDates?.theatrical ?? null,
    digitalRelease: meta.releaseDates?.digital ?? null,
    physicalRelease: meta.releaseDates?.physical ?? null,
    backdropUrl: meta.backdropUrl ?? null,
    genres: meta.genres ?? null,
  }
}

export class MoviesService extends Service {
  static inject = ['database', 'library', 'metadata', 'jobs', 'decision', 'timer']

  db!: Drizzle<typeof schema>
  /** Set while an indexers plugin is loaded. */
  searcher?: MovieSearch
  /** Set while indexers and downloads are loaded (automatic search and grab). */
  searchAndGrab?: (
    movieId: number,
    manual?: boolean,
    targetId?: number | null,
  ) => Promise<{ title: string } | undefined>
  /** Set while a downloads plugin is loaded. */
  grabber?: (
    movieId: number,
    result: SearchResult,
    manual: boolean,
    targetId?: number | null,
  ) => Promise<unknown>

  constructor(ctx: Context) {
    super(ctx, 'movies')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'movies',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define('movies.refresh', async (payload: { id?: number }) => {
      const ids = payload?.id ? [payload.id] : this.list().map((m) => m.id)
      for (const id of ids) await this.refresh(id)
    })
    this.ctx.jobs.schedule('movies.refresh-all', 'movies.refresh', DAY)
    this.ctx.inject(['indexers'], (ctx) => void ctx.plugin(movieSearch, this))
    this.ctx.inject(['indexers', 'downloads'], (ctx) => void ctx.plugin(automation, this))
    this.ctx.inject(['downloads'], (ctx) => {
      ctx.effect(() => {
        this.grabber = (movieId, { release, decision }, manual, targetId) =>
          ctx.downloads.grab(movieId, release, {
            quality: decision.quality,
            formatScore: decision.formatScore,
            manual,
            targetId: targetId ?? null,
          })
        return () => (this.grabber = undefined)
      }, 'movies.grabber')
    })
    this.ctx.library.registerKind({
      id: 'movie',
      label: 'Movies',
      browse: { addPath: '/movies/add', detailPath: '/movie' },
    })
    this.ctx.library.registerNaming('movie', MOVIE_NAMING)
    this.ctx.inject(['import'], (ctx) => void ctx.plugin(movieImport, this))
    this.ctx.inject(['calendar'], (ctx) => void ctx.plugin(movieCalendar, this))
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    this.ctx.inject(['api'], (ctx) => void ctx.plugin(api, this))
  }

  /** Grabs a release from the last search of a movie (interactive "Grab"). */
  async grab(movieId: number, guid: string, targetId?: number | null) {
    const result = this.searcher?.cached(movieId, guid, targetId)
    if (!result) throw new Error('search results expired; search again')
    if (!this.grabber) throw new Error('no download clients are enabled')
    return this.grabber(movieId, result, true, targetId)
  }

  /** Searches the indexers for a movie; throws if no indexers plugin is loaded. */
  search(id: number, kind: 'automatic' | 'interactive' = 'automatic', targetId?: number | null) {
    if (!this.searcher) throw new Error('no indexers are enabled')
    return this.searcher.search(id, kind, targetId)
  }

  private provider() {
    const provider = this.ctx.metadata.for('movie', 'tmdb')
    if (!provider?.getMovie)
      throw new Error('no movie metadata provider is enabled (add TMDB in Settings)')
    return provider
  }

  /** Search TMDB; results already in the library carry their library id. */
  async lookup(term: string) {
    const results = await this.provider().search({ term, kind: 'movie' })
    const existing = new Map(
      this.db
        .select()
        .from(schema.details)
        .all()
        .map((d) => [String(d.tmdbId), d.mediaId]),
    )
    return results.map((r) => ({ ...r, libraryId: existing.get(r.ids.tmdb ?? '') }))
  }

  async add(options: AddMovieOptions): Promise<Movie> {
    if (this.ctx.decision.profile(options.profileId)?.family !== 'video')
      throw new Error('choose a video quality profile')
    const found = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.tmdbId, options.tmdbId))
      .get()
    if (found) throw new Error('this movie is already in the library')
    const meta = await this.provider().getMovie!(String(options.tmdbId))
    if (
      this.db.select().from(schema.details).where(eq(schema.details.tmdbId, options.tmdbId)).get()
    )
      throw new Error('this movie is already in the library')
    const naming = this.ctx.library.naming('movie')
    const item = this.ctx.library.add(
      {
        kind: 'movie',
        title: meta.title,
        year: meta.year ?? null,
        overview: meta.overview ?? null,
        posterUrl: meta.posterUrl ?? null,
        monitored: options.monitored ?? true,
        externalIds: meta.ids,
        primaryProvider: 'tmdb',
        profileId: options.profileId,
        rootFolderId: options.rootFolderId,
        folder:
          options.folder ?? renderName(naming.movieFolder!, { Title: meta.title, Year: meta.year }),
        refreshedAt: Date.now(),
      },
      meta.alternateTitles,
    )
    this.db
      .insert(schema.details)
      .values({
        mediaId: item.id,
        ...detailsFrom(meta),
        minimumAvailability: options.minimumAvailability ?? 'released',
      })
      .run()
    const movie = this.get(item.id)!
    this.ctx.emit('movies/added', movie, { search: options.search ?? true })
    return movie
  }

  async refresh(id: number) {
    const movie = this.get(id)
    if (!movie) return
    const meta = await this.provider().getMovie!(String(movie.details.tmdbId))
    this.db
      .update(schema.details)
      .set(detailsFrom(meta))
      .where(eq(schema.details.mediaId, id))
      .run()
    this.ctx.library.update(
      id,
      {
        title: meta.title,
        year: meta.year ?? null,
        overview: meta.overview ?? null,
        posterUrl: meta.posterUrl ?? null,
        externalIds: { ...movie.externalIds, ...meta.ids },
        refreshedAt: Date.now(),
      },
      meta.alternateTitles,
    )
  }

  /** Library movies a release could be for: by indexer IDs, else by title. */
  findForRelease(
    release: { ids?: { tmdb?: string; imdb?: string } },
    parsed: { title: string },
  ): Movie[] {
    if (release.ids?.tmdb) {
      const d = this.db
        .select()
        .from(schema.details)
        .where(eq(schema.details.tmdbId, Number(release.ids.tmdb)))
        .get()
      if (d) return [this.get(d.mediaId)!]
    }
    if (release.ids?.imdb) {
      const d = this.db
        .select()
        .from(schema.details)
        .where(eq(schema.details.imdbId, release.ids.imdb))
        .get()
      if (d) return [this.get(d.mediaId)!]
    }
    return this.ctx.library
      .findByTitle(parsed.title, 'movie')
      .map((item) => this.get(item.id))
      .filter((m): m is Movie => !!m)
  }

  get(id: number): Movie | undefined {
    const item = this.ctx.library.get(id)
    const details = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.mediaId, id))
      .get()
    if (!item || !details) return
    return this.build(item, details)
  }

  private build(item: MediaItem, details: schema.MovieDetails): Movie {
    const files = this.ctx.library.files(item.id)
    const primary = files.find((f) => !f.targetId)
    return {
      ...item,
      details,
      file: primary,
      files,
      targets: [
        {
          id: null,
          name: null,
          profileId: item.profileId,
          monitored: item.monitored,
          file: primary,
        },
        ...this.ctx.library.targets(item.id).map((t) => ({
          id: t.id,
          name: t.name,
          profileId: t.profileId,
          monitored: t.monitored,
          file: files.find((f) => f.targetId === t.id),
        })),
      ],
    }
  }

  /** A movie's target by id; `null` or absent is the primary target. */
  targetOf(movie: Movie, targetId?: number | null) {
    const target = movie.targets.find((t) => t.id === (targetId ?? null))
    if (!target) throw new Error('this movie has no such version')
    return target
  }

  /** Adds another version of a movie, searched for like the primary one. */
  addTarget(movieId: number, values: { name: string; profileId: number; monitored?: boolean }) {
    if (!this.get(movieId)) throw new Error(`movie ${movieId} not found`)
    if (this.ctx.decision.profile(values.profileId)?.family !== 'video')
      throw new Error('choose a video quality profile')
    this.ctx.library.addTarget(movieId, values)
    const movie = this.get(movieId)!
    const target = movie.targets[movie.targets.length - 1]!
    this.ctx.emit('movies/target-added', movie, target)
    return movie
  }

  updateTarget(
    movieId: number,
    targetId: number,
    patch: { name?: string; profileId?: number; monitored?: boolean },
  ) {
    const movie = this.get(movieId)
    if (!movie || !this.targetOf(movie, targetId).id)
      throw new Error('this movie has no such version')
    if (
      patch.profileId !== undefined &&
      this.ctx.decision.profile(patch.profileId)?.family !== 'video'
    )
      throw new Error('choose a video quality profile')
    this.ctx.library.updateTarget(targetId, patch)
    return this.get(movieId)!
  }

  /**
   * Removes a version. Its file is either kept on disk (the record goes, the file stays) or
   * moved to the recycle bin, as the caller chooses; without a choice a version with a file
   * is refused.
   */
  async removeTarget(movieId: number, targetId: number, files?: 'keep' | 'delete') {
    const movie = this.get(movieId)
    if (!movie) throw new Error(`movie ${movieId} not found`)
    const target = this.targetOf(movie, targetId)
    if (!target.id) throw new Error('the primary version cannot be removed')
    const owned = movie.files.filter((f) => f.targetId === targetId)
    if (owned.length && !files) throw new Error('choose what happens to the version’s files')
    const folder = this.ctx.library.folderOf(movie)
    for (const file of owned) {
      if (files === 'delete')
        await recycle(join(folder, file.path), this.ctx.library.fileHandling().recycleBin)
      this.ctx.library.removeFile(file.id)
    }
    this.ctx.library.removeTarget(targetId)
    return this.get(movieId)!
  }

  list(): Movie[] {
    const details = new Map(
      this.db
        .select()
        .from(schema.details)
        .all()
        .map((d) => [d.mediaId, d]),
    )
    return this.ctx.library
      .list('movie')
      .filter((item) => details.has(item.id))
      .map((item) => this.build(item, details.get(item.id)!))
  }

  update(
    id: number,
    patch: {
      profileId?: number
      monitored?: boolean
      minimumAvailability?: schema.MinimumAvailability
    },
  ) {
    const { minimumAvailability, ...itemPatch } = patch
    if (minimumAvailability) {
      this.db
        .update(schema.details)
        .set({ minimumAvailability })
        .where(eq(schema.details.mediaId, id))
        .run()
    }
    this.ctx.library.update(id, itemPatch)
    return this.get(id)
  }

  markSearched(id: number) {
    this.db
      .update(schema.details)
      .set({ lastSearchedAt: Date.now() })
      .where(eq(schema.details.mediaId, id))
      .run()
  }

  remove(id: number, deleteFiles = false) {
    const movie = this.get(id)
    if (!movie) return
    if (deleteFiles) rmSync(this.ctx.library.folderOf(movie), { recursive: true, force: true })
    this.ctx.library.remove(id)
  }
}

export default MoviesService
