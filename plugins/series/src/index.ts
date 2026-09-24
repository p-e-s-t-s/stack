// @magpiejs/series: the series kind — adding shows from TMDB, seasons and episodes,
// monitoring, refresh and the series pages. Searching, downloading and importing episodes
// are added by the parts of this plugin that need those services (docs/phase-4.md).

import { rmSync } from 'node:fs'
import type {} from '@cordisjs/plugin-timer'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/jobs'
import { cutoffMet } from '@magpiejs/decision'
import { type MediaFile, type MediaItem, renderName } from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import type { EpisodeMetadata, SeriesMetadata } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, eq, inArray } from 'drizzle-orm'
import console_ from './console'
import automation from './automation'
import episodeImport from './import'
import episodeSearch, { type EpisodeResult, type EpisodeSearch, pickReleases } from './search'
import * as schema from './schema'

export * from './schema'
export { episodeFileName } from './import'
export {
  episodesFor,
  matchesSeries,
  pickReleases,
  titlesOf,
  type EpisodeResult,
  type EpisodeSearch,
} from './search'

declare module 'cordis' {
  interface Context {
    series: SeriesService
  }
  interface Events {
    'series/added'(series: Series, options: { search: boolean }): void
    /** Episodes were added, changed or removed by a refresh, or their monitoring changed. */
    'series/episodes'(mediaId: number): void
  }
}

export interface SeriesStats {
  /** Aired, monitored, regular-season episodes. */
  wanted: number
  /** Of those, how many have a file. */
  downloaded: number
  /** All episodes with a file (including unmonitored and specials). */
  files: number
  total: number
  nextAiring?: string
}

export interface Series extends MediaItem {
  details: schema.SeriesDetails
  seasons: schema.Season[]
  stats: SeriesStats
}

export interface AddSeriesOptions {
  tmdbId: number
  profileId: number
  rootFolderId: number
  seriesType?: schema.SeriesType
  seasonFolders?: boolean
  monitor?: schema.MonitorOption
  /** Also monitor specials (season 0). */
  monitorSpecials?: boolean
  /** Search for the monitored episodes right away. */
  search?: boolean
}

const DAY = 86_400_000

/** Today's date as `YYYY-MM-DD` (air dates have no time of day). */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

export const hasAired = (episode: { airDate: string | null }, now = Date.now()) =>
  !!episode.airDate && episode.airDate <= today(now)

function detailsFrom(meta: SeriesMetadata) {
  return {
    tmdbId: Number(meta.ids.tmdb),
    tvdbId: meta.ids.tvdb ? Number(meta.ids.tvdb) : null,
    imdbId: meta.ids.imdb ?? null,
    status: meta.status ?? null,
    network: meta.network ?? null,
    runtimeMinutes: meta.runtimeMinutes ?? null,
    originalLanguage: meta.originalLanguage ?? null,
    backdropUrl: meta.backdropUrl ?? null,
    genres: meta.genres ?? null,
    firstAired: meta.firstAired ?? null,
  }
}

/** Absolute numbers across regular seasons, for providers that don't give them. */
function withAbsoluteNumbers(episodes: EpisodeMetadata[]) {
  const regular = episodes
    .filter((e) => e.season > 0)
    .sort((a, b) => a.season - b.season || a.number - b.number)
  const absolute = new Map(regular.map((e, i) => [e, e.absoluteNumber ?? i + 1]))
  return episodes.map((e) => ({ ...e, absoluteNumber: absolute.get(e) }))
}

/** Whether an episode starts monitored, for a monitoring choice made when adding. */
export function initiallyMonitored(
  episode: { season: number; airDate?: string | null },
  option: schema.MonitorOption,
  seasons: { first?: number; latest?: number },
  now = Date.now(),
) {
  switch (option) {
    case 'all':
    case 'missing':
      return true
    case 'future':
      return !episode.airDate || episode.airDate > today(now)
    case 'first':
      return episode.season === seasons.first
    case 'latest':
      return episode.season === seasons.latest
    case 'none':
      return false
  }
}

export class SeriesService extends Service {
  static inject = ['database', 'library', 'metadata', 'jobs', 'decision', 'timer']

  db!: Drizzle<typeof schema>
  /** Set while an indexers plugin is loaded. */
  searcher?: EpisodeSearch
  /** Set while a downloads plugin is loaded. */
  grabber?: (seriesId: number, result: EpisodeResult, manual: boolean) => Promise<unknown>

  constructor(ctx: Context) {
    super(ctx, 'series')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'series',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.jobs.define('series.refresh', async (payload: { id?: number }) => {
      const ids = payload?.id ? [payload.id] : this.list().map((s) => s.id)
      for (const id of ids) await this.refresh(id)
    })
    this.ctx.jobs.schedule('series.refresh-all', 'series.refresh', DAY)
    this.ctx.inject(['indexers'], (ctx) => void ctx.plugin(episodeSearch, this))
    this.ctx.inject(['import'], (ctx) => void ctx.plugin(episodeImport, this))
    this.ctx.inject(['indexers', 'downloads'], (ctx) => void ctx.plugin(automation, this))
    this.ctx.inject(['downloads'], (ctx) => {
      ctx.effect(() => {
        this.grabber = async (seriesId, { release, decision, episodeIds }, manual) => {
          const grab = await ctx.downloads.grab(seriesId, release, {
            quality: decision.quality,
            formatScore: decision.formatScore,
            manual,
          })
          if (episodeIds.length) {
            this.db
              .insert(schema.grabEpisodes)
              .values(episodeIds.map((episodeId) => ({ grabId: grab.id, episodeId })))
              .run()
          }
          this.ctx.emit('series/episodes', seriesId)
          return grab
        }
        return () => (this.grabber = undefined)
      }, 'series.grabber')

      // a release isn't wanted while an equal or better one for its episodes is downloading
      ctx.decision.rule('episode-in-queue', ({ target, qualityRank, formatScore, rankOf }) => {
        if (target.kind === 'movie' || !target.mediaId || !target.episodeIds?.length) return
        for (const { grab } of this.activeGrabs(target.mediaId)) {
          if (!grab.episodeIds.some((id) => target.episodeIds!.includes(id))) continue
          const rank = rankOf(grab.quality)
          if (rank > qualityRank || (rank === qualityRank && grab.formatScore >= formatScore))
            return `already downloading ${grab.title}`
        }
      })
      for (const event of ['downloads/grabbed', 'downloads/updated'] as const) {
        ctx.on(event, (grab) => {
          if (this.get(grab.mediaId)) this.ctx.emit('series/episodes', grab.mediaId)
        })
      }
    })
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
  }

  provider() {
    const provider = this.ctx.metadata.for('series', 'tmdb')
    if (!provider?.getSeries || !provider.getEpisodes)
      throw new Error('no series metadata provider is enabled (add TMDB in Settings)')
    return provider
  }

  /** Downloads in progress for a series, with the episodes each covers. */
  activeGrabs(seriesId: number) {
    const downloads = this.ctx.get('downloads')
    if (!downloads) return []
    const active = downloads.active().filter((g) => g.mediaId === seriesId)
    if (!active.length) return []
    const links = this.db
      .select()
      .from(schema.grabEpisodes)
      .where(
        inArray(
          schema.grabEpisodes.grabId,
          active.map((g) => g.id),
        ),
      )
      .all()
    return active.map((grab) => ({
      grab: {
        ...grab,
        episodeIds: links.filter((l) => l.grabId === grab.id).map((l) => l.episodeId),
      },
    }))
  }

  /** Episodes a grab covers. */
  grabEpisodes(grabId: number) {
    return this.db
      .select()
      .from(schema.grabEpisodes)
      .where(eq(schema.grabEpisodes.grabId, grabId))
      .all()
      .map((l) => l.episodeId)
  }

  /** Monitored, aired, regular or special episodes without a file or below the cutoff. */
  wantedEpisodes(seriesId: number, now = Date.now()) {
    const series = this.get(seriesId)
    if (!series) return []
    const files = this.episodeFiles(seriesId)
    const profile = this.ctx.decision.profile(series.profileId)
    return this.episodes(seriesId).filter((e) => {
      if (!e.monitored || !hasAired(e, now)) return false
      const file = files.get(e.id)
      return !file || (!!profile && !cutoffMet(profile, file))
    })
  }

  /** Searches indexers for episodes; throws if no indexers plugin is loaded. */
  search(seriesId: number, episodeIds: number[], kind: 'automatic' | 'interactive' = 'automatic') {
    if (!this.searcher) throw new Error('no indexers are enabled')
    return this.searcher.search(seriesId, episodeIds, kind)
  }

  /** Grabs a release from the last search of a series (interactive "Download"). */
  async grab(seriesId: number, guid: string) {
    const result = this.searcher?.cached(seriesId, guid)
    if (!result) throw new Error('search results expired; search again')
    if (!this.grabber) throw new Error('no download clients are enabled')
    return this.grabber(seriesId, result, true)
  }

  /**
   * Searches for episodes (the wanted ones when not given) and grabs the best releases,
   * a season pack where it covers more. Returns what was grabbed.
   */
  async searchAndGrab(seriesId: number, episodeIds?: number[]) {
    if (!this.grabber) throw new Error('set up a download client first')
    const ids = episodeIds ?? this.wantedEpisodes(seriesId).map((e) => e.id)
    if (!ids.length) return []
    const { results } = await this.search(seriesId, ids)
    const grabbed: string[] = []
    for (const result of pickReleases(results, new Set(ids))) {
      await this.grabber(seriesId, result, false)
      grabbed.push(result.release.title)
    }
    return grabbed
  }

  /** Search TMDB; results already in the library carry their library id. */
  async lookup(term: string) {
    const results = await this.provider().search({ term, kind: 'series' })
    const existing = new Map(
      this.db
        .select()
        .from(schema.details)
        .all()
        .map((d) => [String(d.tmdbId), d.mediaId]),
    )
    return results.map((r) => ({ ...r, libraryId: existing.get(r.ids.tmdb ?? '') }))
  }

  async add(options: AddSeriesOptions): Promise<Series> {
    const found = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.tmdbId, options.tmdbId))
      .get()
    if (found) throw new Error('this series is already in the library')
    const provider = this.provider()
    const meta = await provider.getSeries!(String(options.tmdbId))
    const episodes = withAbsoluteNumbers(await provider.getEpisodes!(String(options.tmdbId)))
    const naming = this.ctx.library.naming()
    const monitor = options.monitor ?? 'all'

    const regular = meta.seasons.map((s) => s.number).filter((n) => n > 0)
    const bounds = { first: Math.min(...regular), latest: Math.max(...regular) }
    const monitored = (e: { season: number; airDate?: string | null }) =>
      (e.season > 0 || !!options.monitorSpecials) && initiallyMonitored(e, monitor, bounds)

    const item = this.ctx.library.add(
      {
        kind: 'series',
        title: meta.title,
        year: meta.year ?? null,
        overview: meta.overview ?? null,
        posterUrl: meta.posterUrl ?? null,
        monitored: monitor !== 'none',
        externalIds: meta.ids,
        primaryProvider: 'tmdb',
        profileId: options.profileId,
        rootFolderId: options.rootFolderId,
        folder: renderName(naming.seriesFolder, { 'Series Title': meta.title, Year: meta.year }),
        refreshedAt: Date.now(),
      },
      meta.alternateTitles,
    )
    this.db.transaction((tx) => {
      tx.insert(schema.details)
        .values({
          mediaId: item.id,
          ...detailsFrom(meta),
          seriesType: options.seriesType ?? 'standard',
          seasonFolders: options.seasonFolders ?? true,
          monitorNew: monitor !== 'none',
        })
        .run()
      for (const s of meta.seasons) {
        tx.insert(schema.seasons)
          .values({
            mediaId: item.id,
            number: s.number,
            title: s.title ?? null,
            posterUrl: s.posterUrl ?? null,
            monitored: episodes.some((e) => e.season === s.number && monitored(e)),
          })
          .run()
      }
      for (const e of episodes) {
        tx.insert(schema.episodes)
          .values({ mediaId: item.id, ...episodeValues(e), monitored: monitored(e) })
          .run()
      }
    })
    const series = this.get(item.id)!
    this.ctx.emit('series/added', series, { search: options.search ?? true })
    return series
  }

  /** Updates details, seasons and episodes from the provider. */
  async refresh(id: number) {
    const series = this.get(id)
    if (!series) return
    const provider = this.provider()
    const tmdbId = String(series.details.tmdbId)
    const meta = await provider.getSeries!(tmdbId)
    const fresh = withAbsoluteNumbers(await provider.getEpisodes!(tmdbId))
    const withFiles = new Set(this.episodeFiles(id).keys())
    const monitorNew = series.details.monitorNew && series.monitored

    this.db.transaction((tx) => {
      tx.update(schema.details).set(detailsFrom(meta)).where(eq(schema.details.mediaId, id)).run()
      const knownSeasons = new Set(series.seasons.map((s) => s.number))
      for (const s of meta.seasons) {
        if (knownSeasons.has(s.number)) {
          tx.update(schema.seasons)
            .set({ title: s.title ?? null, posterUrl: s.posterUrl ?? null })
            .where(and(eq(schema.seasons.mediaId, id), eq(schema.seasons.number, s.number)))
            .run()
        } else {
          tx.insert(schema.seasons)
            .values({
              mediaId: id,
              number: s.number,
              title: s.title ?? null,
              posterUrl: s.posterUrl ?? null,
              monitored: monitorNew && s.number > 0,
            })
            .run()
        }
      }

      const existing = new Map(this.episodes(id).map((e) => [`${e.season}x${e.number}`, e]))
      const seasonMonitored = new Map(
        tx
          .select()
          .from(schema.seasons)
          .where(eq(schema.seasons.mediaId, id))
          .all()
          .map((s) => [s.number, s.monitored]),
      )
      for (const e of fresh) {
        const key = `${e.season}x${e.number}`
        const old = existing.get(key)
        existing.delete(key)
        if (old) {
          tx.update(schema.episodes)
            .set(episodeValues(e))
            .where(eq(schema.episodes.id, old.id))
            .run()
        } else {
          const monitored = monitorNew && e.season > 0 && seasonMonitored.get(e.season) !== false
          tx.insert(schema.episodes)
            .values({ mediaId: id, ...episodeValues(e), monitored })
            .run()
        }
      }
      // episodes the provider dropped go too, unless they have a file
      const gone = [...existing.values()].filter((e) => !withFiles.has(e.id)).map((e) => e.id)
      if (gone.length) tx.delete(schema.episodes).where(inArray(schema.episodes.id, gone)).run()
    })

    this.ctx.library.update(
      id,
      {
        title: meta.title,
        year: meta.year ?? null,
        overview: meta.overview ?? null,
        posterUrl: meta.posterUrl ?? null,
        externalIds: { ...series.externalIds, ...meta.ids },
        refreshedAt: Date.now(),
      },
      meta.alternateTitles,
    )
    this.ctx.emit('series/episodes', id)
  }

  /** Library series a release could be for: by indexer ids, else by title. */
  findForRelease(
    release: { ids?: { tvdb?: string; tmdb?: string; imdb?: string } },
    parsed: { title: string },
  ): Series[] {
    const byId = (column: 'tvdbId' | 'tmdbId' | 'imdbId', value: string | number) =>
      this.db.select().from(schema.details).where(eq(schema.details[column], value)).get()
    const ids = release.ids ?? {}
    const found =
      (ids.tvdb && byId('tvdbId', Number(ids.tvdb))) ||
      (ids.tmdb && byId('tmdbId', Number(ids.tmdb))) ||
      (ids.imdb && byId('imdbId', ids.imdb))
    if (found) return [this.get(found.mediaId)!]
    return this.ctx.library
      .findByTitle(parsed.title, 'series')
      .map((item) => this.get(item.id))
      .filter((s): s is Series => !!s)
  }

  get(id: number): Series | undefined {
    const item = this.ctx.library.get(id)
    const details = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.mediaId, id))
      .get()
    if (!item || !details) return
    return this.assemble(item, details)
  }

  list(): Series[] {
    const details = new Map(
      this.db
        .select()
        .from(schema.details)
        .all()
        .map((d) => [d.mediaId, d]),
    )
    return this.ctx.library
      .list('series')
      .filter((item) => details.has(item.id))
      .map((item) => this.assemble(item, details.get(item.id)!))
  }

  private assemble(item: MediaItem, details: schema.SeriesDetails): Series {
    const seasons = this.db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.mediaId, item.id))
      .orderBy(schema.seasons.number)
      .all()
    return { ...item, details, seasons, stats: this.stats(item.id) }
  }

  stats(mediaId: number, now = Date.now()): SeriesStats {
    const episodes = this.episodes(mediaId)
    const files = this.episodeFiles(mediaId)
    const wanted = episodes.filter((e) => e.season > 0 && e.monitored && hasAired(e, now))
    const upcoming = episodes
      .filter((e) => e.airDate && e.airDate > today(now))
      .map((e) => e.airDate!)
      .sort()
    return {
      wanted: wanted.length,
      downloaded: wanted.filter((e) => files.has(e.id)).length,
      files: files.size,
      total: episodes.filter((e) => e.season > 0).length,
      nextAiring: upcoming[0],
    }
  }

  episodes(mediaId: number) {
    return this.db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.mediaId, mediaId))
      .orderBy(schema.episodes.season, schema.episodes.number)
      .all()
  }

  episode(id: number) {
    return this.db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get()
  }

  /** Files of a series by episode id. */
  episodeFiles(mediaId: number): Map<number, MediaFile> {
    const files = new Map(this.ctx.library.files(mediaId).map((f) => [f.id, f]))
    if (!files.size) return new Map()
    const links = this.db
      .select()
      .from(schema.episodeFiles)
      .where(inArray(schema.episodeFiles.fileId, [...files.keys()]))
      .all()
    return new Map(links.map((l) => [l.episodeId, files.get(l.fileId)!]))
  }

  /** Records that a library file holds these episodes (replacing earlier links). */
  linkFile(fileId: number, episodeIds: number[]) {
    this.db.transaction((tx) => {
      for (const episodeId of episodeIds) {
        tx.delete(schema.episodeFiles).where(eq(schema.episodeFiles.episodeId, episodeId)).run()
        tx.insert(schema.episodeFiles).values({ fileId, episodeId }).run()
      }
    })
  }

  update(
    id: number,
    patch: {
      profileId?: number
      monitored?: boolean
      seriesType?: schema.SeriesType
      seasonFolders?: boolean
    },
  ) {
    const { seriesType, seasonFolders, ...itemPatch } = patch
    if (seriesType !== undefined || seasonFolders !== undefined) {
      this.db
        .update(schema.details)
        .set({ seriesType, seasonFolders })
        .where(eq(schema.details.mediaId, id))
        .run()
    }
    this.ctx.library.update(id, itemPatch)
    return this.get(id)
  }

  /** Monitors or unmonitors a season and all its episodes. */
  monitorSeason(mediaId: number, season: number, monitored: boolean) {
    this.db.transaction((tx) => {
      tx.update(schema.seasons)
        .set({ monitored })
        .where(and(eq(schema.seasons.mediaId, mediaId), eq(schema.seasons.number, season)))
        .run()
      tx.update(schema.episodes)
        .set({ monitored })
        .where(and(eq(schema.episodes.mediaId, mediaId), eq(schema.episodes.season, season)))
        .run()
    })
    this.ctx.emit('series/episodes', mediaId)
  }

  monitorEpisodes(episodeIds: number[], monitored: boolean) {
    if (!episodeIds.length) return
    const rows = this.db
      .update(schema.episodes)
      .set({ monitored })
      .where(inArray(schema.episodes.id, episodeIds))
      .returning()
      .all()
    for (const mediaId of new Set(rows.map((r) => r.mediaId)))
      this.ctx.emit('series/episodes', mediaId)
  }

  markSearched(episodeIds: number[], now = Date.now()) {
    if (!episodeIds.length) return
    this.db
      .update(schema.episodes)
      .set({ lastSearchedAt: now })
      .where(inArray(schema.episodes.id, episodeIds))
      .run()
  }

  remove(id: number, deleteFiles = false) {
    const series = this.get(id)
    if (!series) return
    if (deleteFiles) rmSync(this.ctx.library.folderOf(series), { recursive: true, force: true })
    this.ctx.library.remove(id)
  }
}

function episodeValues(e: EpisodeMetadata & { absoluteNumber?: number }) {
  return {
    season: e.season,
    number: e.number,
    absoluteNumber: e.absoluteNumber ?? null,
    title: e.title ?? null,
    overview: e.overview ?? null,
    airDate: e.airDate ?? null,
    runtimeMinutes: e.runtimeMinutes ?? null,
  }
}

export default SeriesService
