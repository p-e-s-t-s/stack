// Episode searching. Loaded only while an indexers plugin is enabled: builds queries for the
// wanted episodes, matches results to the series and to episodes, and runs them through the
// decision engine with the episodes each release covers.

import {
  compareDecisions,
  type Decision,
  type DecisionTarget,
  profileRanks,
} from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import { normalizeTitle, type ParsedRelease, parse } from '@magpiejs/parser'
import type { ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { Series, SeriesService } from './index'
import type { Episode } from './schema'

export type FoundRelease = ReleaseInfo & {
  indexerName: string
  indexerPriority: number
  flags?: string[]
}

export interface EpisodeResult {
  release: FoundRelease
  decision: Decision
  /** Episodes of the series this release covers. */
  episodeIds: number[]
}

export interface EpisodeSearch {
  /** Searches for these episodes (all monitored, aired, wanted ones when omitted). */
  search(
    seriesId: number,
    episodeIds: number[],
    kind?: 'automatic' | 'interactive',
  ): Promise<{ results: EpisodeResult[]; errors: { indexer: string; message: string }[] }>
  cached(seriesId: number, guid: string): EpisodeResult | undefined
  /** Matches and evaluates releases for a series, best first (used by search and RSS). */
  evaluate(seriesId: number, releases: FoundRelease[], wantedIds: Set<number>): EpisodeResult[]
}

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

/** Picks releases to grab: best first, skipping ones whose wanted episodes are already covered. */
export function pickReleases(results: EpisodeResult[], wanted: Set<number>) {
  const picked: EpisodeResult[] = []
  const covered = new Set<number>()
  for (const r of results) {
    if (!r.decision.accepted) continue
    const fresh = r.episodeIds.filter((id) => wanted.has(id) && !covered.has(id))
    // a release that repeats anything already picked would download it twice
    if (!fresh.length || r.episodeIds.some((id) => covered.has(id))) continue
    picked.push(r)
    for (const id of r.episodeIds) covered.add(id)
  }
  return picked
}

export default function episodeSearch(ctx: Context, series: SeriesService) {
  const cache = new Map<number, { at: number; results: Map<string, EpisodeResult> }>()

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
      episodeIds: covered.map((e) => e.id),
      current: worst && {
        quality: worst.quality as never,
        formatScore: worst.formatScore,
        revision: worst.revision,
      },
    }
  }

  const api: EpisodeSearch = {
    async search(seriesId, episodeIds, kind = 'automatic') {
      const show = series.get(seriesId)
      if (!show) throw new Error(`series ${seriesId} not found`)
      const all = series.episodes(seriesId)
      const wanted = all.filter((e) => episodeIds.includes(e.id))
      if (!wanted.length) return { results: [], errors: [] }

      const releases: FoundRelease[] = []
      const errors: { indexer: string; message: string }[] = []
      for (const query of queries(show, wanted)) {
        const outcome = await ctx.indexers.search(query, kind)
        releases.push(...(outcome.releases as FoundRelease[]))
        errors.push(...outcome.errors)
      }

      const wantedIds = new Set(wanted.map((e) => e.id))
      const results = api.evaluate(seriesId, releases, wantedIds)
      cache.set(seriesId, {
        at: Date.now(),
        results: new Map(results.map((r) => [r.release.guid, r])),
      })
      series.markSearched([...wantedIds])
      return { results, errors }
    },
    evaluate(seriesId, releases, wantedIds) {
      const show = series.get(seriesId)
      if (!show) return []
      const all = series.episodes(seriesId)
      const titles = titlesOf(show, ctx.library.alternateTitlesOf(show.id))
      const seen = new Set<string>()
      const results: EpisodeResult[] = []
      for (const release of releases) {
        if (seen.has(release.guid)) continue
        seen.add(release.guid)
        const parsed = parse(release.title, { kind: 'series' })
        const covered = episodesFor(show, parsed, all)
        const decision = ctx.decision.evaluate(
          { info: release, parsed },
          targetFor(show, parsed, covered),
        )
        const reject = (rule: string, reason: string) => {
          decision.rejections.unshift({ rule, reason, permanent: true })
          decision.accepted = false
        }
        if (!matchesSeries(show, release, parsed, titles))
          reject('series-match', 'is not this series')
        else if (!covered.length) reject('episode-match', 'is not an episode of this series')
        else if (!covered.some((e) => wantedIds.has(e.id)))
          reject('episode-match', 'has none of the wanted episodes')
        // prefer releases that cover more wanted episodes, then indexer priority
        decision.rank.push(covered.filter((e) => wantedIds.has(e.id)).length)
        decision.rank.push(-release.indexerPriority)
        results.push({ release, decision, episodeIds: covered.map((e) => e.id) })
      }
      return results.sort(
        (a, b) =>
          Number(b.decision.accepted) - Number(a.decision.accepted) ||
          compareDecisions(a.decision, b.decision),
      )
    },
    cached(seriesId, guid) {
      const entry = cache.get(seriesId)
      if (!entry || Date.now() - entry.at > 60 * 60_000) return
      return entry.results.get(guid)
    },
  }

  ctx.effect(() => {
    series.searcher = api
    return () => (series.searcher = undefined)
  }, 'series.searcher')
}
