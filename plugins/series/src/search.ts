// Episode searching. Loaded only while an indexers plugin is enabled: builds queries for the
// wanted episodes, and matches results to the series and to the episodes they cover (the
// searching, evaluating and caching itself is @magpiejs/units').

import { type DecisionTarget, profileRanks } from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import { normalizeTitle, type ParsedRelease, parse } from '@magpiejs/parser'
import type { ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import { unitSearch } from '@magpiejs/units'
import type { Context } from 'cordis'
import type { Series, SeriesService } from './index'
import type { Episode } from './schema'

export type {
  FoundRelease,
  UnitResult as EpisodeResult,
  UnitSearch as EpisodeSearch,
} from '@magpiejs/units'

/** Normalized titles a release for this series may use: title, alternates, "title year". */
export function titlesOf(series: Series, alternates: string[]) {
  const titles = new Set([series.title, ...alternates].map(normalizeTitle))
  if (series.year) titles.add(normalizeTitle(`${series.title} ${series.year}`))
  return titles
}

/** Whether a release is for this series: indexer IDs if present, else the title. */
export function matchesSeries(
  series: Series,
  info: ReleaseInfo,
  parsed: ParsedRelease,
  titles: Set<string>,
) {
  const ids = series.externalIds
  if (info.ids?.tvdb && ids.tvdb) return info.ids.tvdb === ids.tvdb
  if (info.ids?.tmdb && ids.tmdb) return info.ids.tmdb === ids.tmdb
  if (info.ids?.imdb && ids.imdb) return info.ids.imdb === ids.imdb
  return titles.has(normalizeTitle(parsed.title))
}

/** The episodes a parsed release covers. Empty when it doesn't name any we know. */
export function episodesFor(series: Series, parsed: ParsedRelease, episodes: Episode[]) {
  const eps = parsed.episodes
  if (!eps) return []
  if (eps.airDate) return episodes.filter((e) => e.airDate === eps.airDate)
  if (parsed.kind === 'season') {
    const seasons = eps.seasons ?? (eps.season !== undefined ? [eps.season] : [])
    return episodes.filter((e) => seasons.includes(e.season))
  }
  if (eps.season === undefined || series.details.seriesType === 'anime') {
    // absolute numbering (anime), or `E13` without a season
    const absolute = eps.absolute ?? (eps.season === undefined ? eps.numbers : [])
    if (absolute.length) {
      const found = episodes.filter((e) => e.absoluteNumber && absolute.includes(e.absoluteNumber))
      if (found.length || eps.season === undefined) return found
    }
  }
  return episodes.filter((e) => e.season === eps.season && eps.numbers.includes(e.number))
}

export default function episodeSearch(ctx: Context, series: SeriesService) {
  /**
   * Queries for these episodes. Standard: one per season, with the episode when it's the only
   * one. Daily: by air date. Anime: by title and absolute number, plus the season queries.
   */
  function queries(show: Series, wanted: Episode[]): ReleaseQuery[] {
    const base = { kind: 'series' as const, term: show.title, ids: show.externalIds }
    const type = show.details.seriesType
    const few = wanted.length <= 5
    if (type === 'daily') {
      const dated = wanted.filter((e) => e.airDate)
      if (!few || !dated.length) return [base]
      return dated.map((e) => ({
        ...base,
        season: Number(e.airDate!.slice(0, 4)),
        episode: `${e.airDate!.slice(5, 7)}/${e.airDate!.slice(8, 10)}`,
      }))
    }
    const bySeason = new Map<number, Episode[]>()
    for (const e of wanted) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e])
    const seasonal: ReleaseQuery[] = [...bySeason].map(([season, eps]) =>
      eps.length === 1 ? { ...base, season, episode: eps[0]!.number } : { ...base, season },
    )
    if (type !== 'anime') return seasonal
    // anime releases are mostly named by absolute number: search by text, without ids
    const absolute = wanted.filter((e) => e.absoluteNumber)
    const text: ReleaseQuery[] = few
      ? absolute.map((e) => ({
          kind: 'series',
          term: `${show.title} ${String(e.absoluteNumber).padStart(2, '0')}`,
        }))
      : [{ kind: 'series', term: show.title }]
    return [...seasonal, ...text]
  }

  function targetFor(show: Series, parsed: ParsedRelease, covered: Episode[]): DecisionTarget {
    const files = series.episodeFiles(show.id)
    const current = covered.map((e) => files.get(e.id))
    const profile = ctx.decision.profile(show.profileId)
    const rankOf = profile ? profileRanks(profile).rankOf : () => 0
    // upgrade only when every covered episode has a file; otherwise it fills a gap
    const worst = current.every(Boolean)
      ? current.sort(
          (a, b) => rankOf(a!.quality) - rankOf(b!.quality) || a!.formatScore - b!.formatScore,
        )[0]
      : undefined
    const season = covered[0]?.season ?? parsed.episodes?.season ?? 0
    return {
      kind: parsed.kind === 'season' ? 'season' : 'episode',
      mediaId: show.id,
      profileId: show.profileId,
      runtimeMinutes: show.details.runtimeMinutes ?? undefined,
      originalLanguage: show.details.originalLanguage ?? undefined,
      episodes: {
        season,
        numbers: parsed.kind === 'season' ? [] : covered.map((e) => e.number),
      },
      unitIds: covered.map((e) => e.id),
      current: worst && {
        quality: worst.quality as never,
        formatScore: worst.formatScore,
        revision: worst.revision,
      },
    }
  }

  const api = unitSearch<Series, Episode>(ctx, {
    item: (id) => series.get(id),
    units: (id) => series.episodes(id),
    queries,
    parse: (title) => parse(title, { kind: 'series' }),
    matcher(show, all, wanted) {
      const titles = titlesOf(show, ctx.library.alternateTitlesOf(show.id))
      return (base, release) => {
        const parsed = base as ParsedRelease
        if (!matchesSeries(show, release, parsed, titles))
          return { reject: { rule: 'series-match', reason: 'is not this series' } }
        const covered = episodesFor(show, parsed, all)
        if (!covered.length)
          return { reject: { rule: 'episode-match', reason: 'is not an episode of this series' } }
        if (!covered.some((e) => wanted.has(e.id)))
          return { reject: { rule: 'episode-match', reason: 'has none of the wanted episodes' } }
        return { units: covered }
      }
    },
    target: (show, parsed, covered) => targetFor(show, parsed as ParsedRelease, covered),
    // prefer releases that cover more wanted episodes
    rank: (covered, wanted) => [covered.filter((e) => wanted.has(e.id)).length],
    markSearched: (_, ids) => series.markSearched(ids),
  })

  ctx.indexers.searchType('series', {
    mode: 'tvsearch',
    ids: { tvdb: 'tvdbid', imdb: 'imdbid' },
    defaultCategories: [5000],
  })

  ctx.effect(() => {
    series.searcher = api
    return () => (series.searcher = undefined)
  }, 'series.searcher')
}
