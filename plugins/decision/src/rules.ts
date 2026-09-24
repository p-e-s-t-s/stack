// Built-in decision rules (docs/phase-2.md §3.4), for every quality family. A rule returns a
// rejection reason, or nothing to accept. Families add their own rules (video: hardcoded
// subtitles, episode match); other plugins add rules with `ctx.decision.rule()`.

import type { Revision } from '@magpiejs/parser'
import type { ReleaseInfo } from '@magpiejs/types'
import type { BaseParsed, QualityFamily } from './families'
import type { Profile, QualitySize, Restriction } from './schema'

export interface DecisionTarget {
  /** `movie`, `episode`, `season`, or a kind plugin's own unit (`album`, `book`…). */
  kind: string
  /** Library item being searched for (used by rules such as the blocklist). */
  mediaId?: number
  profileId: number
  runtimeMinutes?: number
  originalLanguage?: string
  /** For `episode`: the wanted episodes; for `season`: `numbers` is empty. */
  episodes?: { season: number; numbers: number[] }
  /**
   * Ids of the parts of the item a release covers (episodes, albums, books), for kind
   * plugins' own rules such as "already downloading".
   */
  unitIds?: number[]
  /** The file already on disk, if any. */
  current?: { quality: string; formatScore: number; revision: Revision }
}

export interface RuleContext {
  info: ReleaseInfo
  /** The family's parse of the release name (a `ParsedRelease` for video). */
  parsed: BaseParsed
  target: DecisionTarget
  profile: Profile
  family: QualityFamily
  quality: string
  /** Display name of a quality. */
  qualityName(quality: string): string
  /** Position in the profile (groups share one); -1 when not in the profile. */
  qualityRank: number
  qualityAllowed: boolean
  formatScore: number
  size?: QualitySize
  restrictions: Restriction[]
  /** Rank of a quality in this profile (for comparisons against the current file). */
  rankOf(quality: string): number
  cutoffRank: number
  now: number
}

export interface Rejection {
  reason: string
  /** Permanent rejections won't change on a later search (e.g. wrong language). */
  permanent?: boolean
}

export type Rule = (context: RuleContext) => Rejection | string | undefined | void

function containsTerm(title: string, term: string) {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(term)
  if (regex) {
    try {
      return new RegExp(regex[1]!, regex[2] || 'i').test(title)
    } catch {
      return false
    }
  }
  return title.toLowerCase().includes(term.toLowerCase())
}

/** Compares releases/files: quality rank, then format score, then revision. */
export function isBetter(
  a: { rank: number; formatScore: number; revision: Revision },
  b: { rank: number; formatScore: number; revision: Revision },
) {
  if (a.rank !== b.rank) return a.rank > b.rank
  if (a.formatScore !== b.formatScore) return a.formatScore > b.formatScore
  if (a.revision.version !== b.revision.version) return a.revision.version > b.revision.version
  return a.revision.real > b.revision.real
}

export const BUILTIN_RULES: Record<string, Rule> = {
  sample: ({ parsed }) => {
    if (parsed.flags.includes('sample')) return { reason: 'is a sample', permanent: true }
    if (parsed.flags.includes('extras')) return { reason: 'contains only extras', permanent: true }
  },

  'quality-allowed': ({ quality, qualityAllowed, qualityName }) => {
    if (!qualityAllowed)
      return { reason: `${qualityName(quality)} is not allowed by the profile`, permanent: true }
  },

  size: ({ info, size, target, quality, family, qualityName }) => {
    if (!size || !info.size || family.sizeRule === 'none') return
    // MB per minute of runtime (video, audio) or MB in total (books)
    const perMinute = family.sizeRule === 'perMinute'
    if (perMinute && !target.runtimeMinutes) return
    const mb = info.size / 1024 ** 2 / (perMinute ? target.runtimeMinutes! : 1)
    const unit = perMinute ? 'MB/min' : 'MB'
    if (mb < size.min)
      return {
        reason: `too small for ${qualityName(quality)} (${mb.toFixed(1)} ${unit}, minimum ${size.min})`,
        permanent: true,
      }
    if (size.max && mb > size.max)
      return {
        reason: `too large for ${qualityName(quality)} (${mb.toFixed(1)} ${unit}, maximum ${size.max})`,
        permanent: true,
      }
  },

  restrictions: ({ info, restrictions }) => {
    for (const r of restrictions) {
      const ignored = r.ignored.find((term) => containsTerm(info.title, term))
      if (ignored) return { reason: `contains ignored term "${ignored}"`, permanent: true }
      if (r.required.length && !r.required.some((term) => containsTerm(info.title, term))) {
        return { reason: `missing a required term (${r.required.join(', ')})`, permanent: true }
      }
    }
  },

  language: ({ parsed, profile, target }) => {
    if (!profile.languages.length) return
    const wanted = profile.languages.map((l) => (l === 'original' ? target.originalLanguage : l))
    if (!parsed.languages.some((l) => wanted.includes(l))) {
      return { reason: `language ${parsed.languages.join(', ')} is not wanted`, permanent: true }
    }
  },

  'min-format-score': ({ formatScore, profile }) => {
    if (formatScore < profile.minFormatScore) {
      return {
        reason: `custom format score ${formatScore} is below the minimum ${profile.minFormatScore}`,
        permanent: true,
      }
    }
  },

  seeders: ({ info, profile }) => {
    if (info.protocol !== 'torrent' || info.seeders === undefined) return
    if (info.seeders < profile.minSeeders)
      return `only ${info.seeders} seeders (minimum ${profile.minSeeders})`
  },

  'min-age': ({ info, profile, now }) => {
    if (info.protocol !== 'usenet' || !profile.minAgeMinutes || !info.publishedAt) return
    const age = (now - Date.parse(info.publishedAt)) / 60_000
    if (age < profile.minAgeMinutes)
      return `only ${Math.floor(age)} minutes old (minimum ${profile.minAgeMinutes})`
  },

  upgrade: ({ target, profile, qualityRank, formatScore, parsed, rankOf, cutoffRank }) => {
    const current = target.current
    if (!current) return
    if (!profile.upgradesAllowed) return { reason: 'a file exists and upgrades are disabled' }
    const currentRank = rankOf(current.quality)
    if (currentRank >= cutoffRank && current.formatScore >= profile.cutoffFormatScore) {
      return { reason: 'existing file already meets the cutoff' }
    }
    const candidate = { rank: qualityRank, formatScore, revision: parsed.revision }
    if (
      !isBetter(candidate, {
        rank: currentRank,
        formatScore: current.formatScore,
        revision: current.revision,
      })
    ) {
      return { reason: 'not an upgrade over the existing file' }
    }
  },
}
