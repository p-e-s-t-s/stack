// @magpiejs/movies: the movie kind — adding movies from TMDB, availability, refresh, pages.
// Searching and downloading are done by other plugins listening to `movies/*` events.

import { rmSync } from 'node:fs'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@cordisjs/plugin-timer'
import type {} from '@magpiejs/api'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import { type MediaFile, type MediaItem, renderName } from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import type { MovieMetadata } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { eq } from 'drizzle-orm'
import api from './api'
import console_ from './console'
import automation from './automation'
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
  }
}

export interface Movie extends MediaItem {
  details: schema.MovieDetails
  file?: MediaFile
}

export interface AddMovieOptions {
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
  searchAndGrab?: (movieId: number, manual?: boolean) => Promise<{ title: string } | undefined>
  /** Set while a downloads plugin is loaded. */
  grabber?: (movieId: number, result: SearchResult, manual: boolean) => Promise<unknown>

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
        this.grabber = (movieId, { release, decision }, manual) =>
          ctx.downloads.grab(movieId, release, {
            quality: decision.quality,
            formatScore: decision.formatScore,
            manual,
          })
        return () => (this.grabber = undefined)
      }, 'movies.grabber')
    })
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    this.ctx.inject(['api'], (ctx) => void ctx.plugin(api, this))
  }

  /** Grabs a release from the last search of a movie (interactive "Grab"). */
  async grab(movieId: number, guid: string) {
    const result = this.searcher?.cached(movieId, guid)
    if (!result) throw new Error('search results expired; search again')
    if (!this.grabber) throw new Error('no download clients are enabled')
    return this.grabber(movieId, result, true)
  }

  /** Searches the indexers for a movie; throws if no indexers plugin is loaded. */
  search(id: number, kind: 'automatic' | 'interactive' = 'automatic') {
    if (!this.searcher) throw new Error('no indexers are enabled')
    return this.searcher.search(id, kind)
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
    const found = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.tmdbId, options.tmdbId))
      .get()
    if (found) throw new Error('this movie is already in the library')
    const meta = await this.provider().getMovie!(String(options.tmdbId))
    const naming = this.ctx.library.naming()
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
        folder: renderName(naming.movieFolder, { Title: meta.title, Year: meta.year }),
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
    return { ...item, details, file: this.ctx.library.files(id)[0] }
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
      .map((item) => ({
        ...item,
        details: details.get(item.id)!,
        file: this.ctx.library.files(item.id)[0],
      }))
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
