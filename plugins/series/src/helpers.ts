// Pure helpers for the series service: air dates, monitoring choices and metadata mapping.

import type { EpisodeMetadata, SeriesMetadata } from '@magpiejs/types'
import type * as schema from './schema'

/** Today's date as `YYYY-MM-DD` (air dates have no time of day). */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

export const hasAired = (episode: { airDate: string | null }, now = Date.now()) =>
  !!episode.airDate && episode.airDate <= today(now)

export function detailsFrom(meta: SeriesMetadata) {
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
export function withAbsoluteNumbers(episodes: EpisodeMetadata[]) {
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

export function episodeValues(e: EpisodeMetadata & { absoluteNumber?: number }) {
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
