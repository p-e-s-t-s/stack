// @magpiejs/units: what kinds of media whose library items have parts — a series' episodes,
// an author's books, an artist's albums — share: searching indexers for wanted parts and
// matching results to them, picking releases to grab, grabbing them with the parts they
// cover, and the automation around it (search on add, after a failed download, a daily sweep
// of wanted parts, RSS). A kind plugin describes its items and parts; this does the rest.

import {
  type BaseParsed,
  compareDecisions,
  type Decision,
  type DecisionTarget,
} from '@magpiejs/decision'
import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import type {} from '@magpiejs/jobs'
import type { ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import type { Context } from 'cordis'

/** An indexer result, with where it came from. */
export type FoundRelease = ReleaseInfo & {
  indexerName: string
  indexerPriority: number
  flags?: string[]
}

export interface UnitResult {
  release: FoundRelease
  decision: Decision
  /** The parts of the item the release covers (empty when it isn't this item's). */
  unitIds: number[]
}

export interface Unit {
  id: number
}

/** How a release relates to an item: the parts it covers, or why it doesn't. */
export type UnitMatch<U> = { units: U[] } | { reject: { rule: string; reason: string } }

export interface UnitSearchSpec<I extends { id: number; profileId: number }, U extends Unit> {
  /** The library item, if it's still one of this kind's. */
  item(mediaId: number): I | undefined
  /** All of the item's parts. */
  units(mediaId: number): U[]
  /** Queries for the wanted parts. */
  queries(item: I, wanted: U[]): ReleaseQuery[]
  /** Runs before searching (e.g. fetching track lists for size limits). */
  prepare?(item: I, wanted: U[]): Promise<void>
  parse(title: string): BaseParsed
  /**
   * Builds a matcher for one evaluation (so per-item work, like the item's titles, is done
   * once): which parts a release covers, or why it isn't this item's.
   */
  matcher(
    item: I,
    units: U[],
    wanted: Set<number>,
  ): (parsed: BaseParsed, release: FoundRelease) => UnitMatch<U>
  /** The decision target for a release covering these parts. */
  target(item: I, parsed: BaseParsed, covered: U[]): DecisionTarget
  /** Extra ranking between accepted releases, before indexer priority (higher is better). */
  rank?(covered: U[], wanted: Set<number>): number[]
  /** Records when parts were last searched for. */
  markSearched(mediaId: number, unitIds: number[]): void
}

export interface UnitSearch {
  /** Searches indexers for these parts of an item. */
  search(
    mediaId: number,
    unitIds: number[],
    kind?: 'automatic' | 'interactive',
  ): Promise<{ results: UnitResult[]; errors: { indexer: string; message: string }[] }>
  /** A result of the item's last search (for grabbing from the interactive list). */
  cached(mediaId: number, guid: string): UnitResult | undefined
  /** Matches and evaluates releases for an item, best first (used by search and RSS). */
  evaluate(mediaId: number, releases: FoundRelease[], wanted: Set<number>): UnitResult[]
}

/** How long interactive results can be grabbed from. */
const CACHE_MS = 60 * 60_000

export function unitSearch<I extends { id: number; profileId: number }, U extends Unit>(
  ctx: Context,
  spec: UnitSearchSpec<I, U>,
): UnitSearch {
  const cache = new Map<number, { at: number; results: Map<string, UnitResult> }>()

  const api: UnitSearch = {
    async search(mediaId, unitIds, kind = 'automatic') {
      const item = spec.item(mediaId)
      if (!item) throw new Error(`library item ${mediaId} not found`)
      const wanted = spec.units(mediaId).filter((u) => unitIds.includes(u.id))
      if (!wanted.length) return { results: [], errors: [] }
      await spec.prepare?.(item, wanted)
      const releases: FoundRelease[] = []
      const errors: { indexer: string; message: string }[] = []
      for (const query of spec.queries(item, wanted)) {
        const outcome = await ctx.indexers.search(query, kind)
        releases.push(...(outcome.releases as FoundRelease[]))
        errors.push(...outcome.errors)
      }
      const wantedIds = new Set(wanted.map((u) => u.id))
      const results = api.evaluate(mediaId, releases, wantedIds)
      cache.set(mediaId, {
        at: Date.now(),
        results: new Map(results.map((r) => [r.release.guid, r])),
      })
      spec.markSearched(mediaId, [...wantedIds])
      return { results, errors }
    },

    evaluate(mediaId, releases, wanted) {
      const item = spec.item(mediaId)
      if (!item) return []
      const units = spec.units(mediaId)
      const match = spec.matcher(item, units, wanted)
      const seen = new Set<string>()
      const results: UnitResult[] = []
      for (const release of releases) {
        if (seen.has(release.guid)) continue
        seen.add(release.guid)
        const parsed = spec.parse(release.title)
        const matched = match(parsed, release)
        const covered = 'units' in matched ? matched.units : []
        const decision = ctx.decision.evaluate(
          { info: release, parsed },
          spec.target(item, parsed, covered),
        )
        const reject = (rule: string, reason: string) => {
          decision.rejections.unshift({ rule, reason, permanent: true })
          decision.accepted = false
        }
        if ('reject' in matched) reject(matched.reject.rule, matched.reject.reason)
        else if (!covered.some((u) => wanted.has(u.id)))
          reject('unit-match', 'has none of the wanted parts')
        decision.rank.push(...(spec.rank?.(covered, wanted) ?? []), -release.indexerPriority)
        results.push({ release, decision, unitIds: covered.map((u) => u.id) })
      }
      return results.sort(
        (a, b) =>
          Number(b.decision.accepted) - Number(a.decision.accepted) ||
          compareDecisions(a.decision, b.decision),
      )
    },

    cached(mediaId, guid) {
      const entry = cache.get(mediaId)
      if (!entry || Date.now() - entry.at > CACHE_MS) return
      return entry.results.get(guid)
    },
  }
  return api
}

/**
 * Releases to grab, best first: accepted ones that bring a wanted part not yet covered, and
 * don't repeat a part already picked (it would be downloaded twice).
 */
export function pickReleases<R extends { decision: Decision; unitIds: number[] }>(
  results: R[],
  wanted: Set<number>,
) {
  const picked: R[] = []
  const covered = new Set<number>()
  for (const r of results) {
    if (!r.decision.accepted) continue
    if (!r.unitIds.some((id) => wanted.has(id) && !covered.has(id))) continue
    if (r.unitIds.some((id) => covered.has(id))) continue
    picked.push(r)
    for (const id of r.unitIds) covered.add(id)
  }
  return picked
}

/** Sends a result to a download client, recording the parts it covers. */
export function grabResult(ctx: Context, mediaId: number, result: UnitResult, manual: boolean) {
  return ctx.downloads.grab(mediaId, result.release, {
    quality: result.decision.quality,
    formatScore: result.decision.formatScore,
    manual,
    unitIds: result.unitIds,
  })
}

// ---- automation

export interface UnitAutomationSpec {
  /** Job names start with it: `<name>.search`, `<name>.wanted`. */
  name: string
  item(mediaId: number): { monitored: boolean; title: string } | undefined
  items(): { id: number; monitored: boolean }[]
  /** Parts wanted now: monitored, out, without a (good enough) file. */
  wanted(mediaId: number, now: number): { id: number; lastSearchedAt: number | null }[]
  searcher(): UnitSearch | undefined
  /** Searches and grabs; returns the titles grabbed. */
  searchAndGrab(mediaId: number, unitIds: number[]): Promise<string[]>
  grab(mediaId: number, result: UnitResult): Promise<unknown>
  /** Library items (monitored ones) an RSS release may be for. */
  rssItems(release: FoundRelease): number[]
  /** Runs before RSS results for an item are evaluated. */
  prepareRss?(mediaId: number, wanted: Set<number>): Promise<void>
  /** Items searched per daily sweep. */
  sweepBatch?: number
}

const DAY = 86_400_000

/**
 * Searching and grabbing without being asked: `enqueue` (for "search on add"), after a failed
 * download (for the next best release), a daily sweep of items with wanted parts that weren't
 * searched in the last day, and RSS. Needs the indexers, downloads and jobs services.
 */
export function unitAutomation(ctx: Context, spec: UnitAutomationSpec) {
  const job = `${spec.name}.search`
  const enqueue = (mediaId: number, unitIds?: number[]) =>
    ctx.jobs.enqueue(
      job,
      { mediaId, unitIds },
      // one pending search per item (or per set of parts)
      { dedupeKey: `${job}:${mediaId}:${unitIds?.join(',') ?? 'wanted'}` },
    )

  ctx.jobs.define(
    job,
    async ({ mediaId, unitIds }: { mediaId: number; unitIds?: number[] }) => {
      const item = spec.item(mediaId)
      if (!item?.monitored) return
      // only parts that are still wanted (a file may have arrived meanwhile)
      const wanted = new Set(spec.wanted(mediaId, Date.now()).map((u) => u.id))
      const ids = (unitIds ?? [...wanted]).filter((id) => wanted.has(id))
      if (!ids.length) return
      const grabbed = await spec.searchAndGrab(mediaId, ids)
      if (!grabbed.length) ctx.logger.info('no acceptable release found for %s', item.title)
    },
    { maxAttempts: 3, retryDelayMs: 5 * 60_000 },
  )

  // a failed download is blocklisted by the downloads plugin; look for the next best release
  ctx.on('downloads/failed', (grab) => {
    if (spec.item(grab.mediaId)) enqueue(grab.mediaId, ctx.downloads.unitsOf(grab.id))
  })

  const sweep = `${spec.name}.wanted`
  ctx.jobs.define(sweep, () => {
    const now = Date.now()
    const due = spec
      .items()
      .filter((item) => item.monitored)
      .map((item) => {
        const wanted = spec.wanted(item.id, now)
        return { item, wanted, last: Math.min(...wanted.map((u) => u.lastSearchedAt ?? 0)) }
      })
      .filter(({ wanted, last }) => wanted.length && now - last > DAY)
      .sort((a, b) => a.last - b.last)
      .slice(0, spec.sweepBatch ?? 20)
    for (const { item } of due) enqueue(item.id)
  })
  ctx.jobs.schedule(sweep, sweep, DAY)

  // RSS: match new releases to items and their wanted parts, grab the best per item
  ctx.on('indexers/rss', async (releases) => {
    const searcher = spec.searcher()
    if (!searcher) return
    const byItem = new Map<number, FoundRelease[]>()
    for (const release of releases as FoundRelease[])
      for (const id of spec.rssItems(release)) byItem.set(id, [...(byItem.get(id) ?? []), release])
    for (const [mediaId, candidates] of byItem) {
      const wanted = new Set(spec.wanted(mediaId, Date.now()).map((u) => u.id))
      if (!wanted.size) continue
      await spec.prepareRss?.(mediaId, wanted)
      for (const result of pickReleases(searcher.evaluate(mediaId, candidates, wanted), wanted)) {
        try {
          await spec.grab(mediaId, result)
        } catch (error) {
          ctx.logger.warn('could not grab %s from RSS: %s', result.release.title, error)
        }
      }
    }
  })

  return { enqueue }
}
