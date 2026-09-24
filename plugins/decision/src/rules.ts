// Built-in decision rules (docs/phase-2.md §3.4). A rule returns a rejection reason, or
// nothing to accept. Other plugins add rules with `ctx.decision.rule()`.

import type { ParsedRelease, Revision } from '@magpiejs/parser'
import type { ReleaseInfo } from '@magpiejs/types'
import { type Quality, QUALITY_NAMES } from './qualities'
import type { Profile, QualitySize, Restriction } from './schema'

export interface DecisionTarget {
  kind: 'movie' | 'episode' | 'season'
  profileId: number
  runtimeMinutes?: number
  originalLanguage?: string
  /** For `episode`: the wanted episodes; for `season`: `numbers` is empty. */
  episodes?: { season: number; numbers: number[] }
  /** The file already on disk, if any. */
  current?: { quality: Quality; formatScore: number; revision: Revision }
}

export interface RuleContext {
  info: ReleaseInfo
  parsed: ParsedRelease
  target: DecisionTarget
  profile: Profile
  quality: Quality
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

  'quality-allowed': ({ quality, qualityAllowed }) => {
    if (!qualityAllowed)
      return { reason: `${QUALITY_NAMES[quality]} is not allowed by the profile`, permanent: true }
  },

  size: ({ info, size, target, quality }) => {
    if (!size || !info.size || !target.runtimeMinutes) return
    const mbPerMinute = info.size / 1024 ** 2 / target.runtimeMinutes
    if (mbPerMinute < size.min)
      return {
        reason: `too small for ${QUALITY_NAMES[quality]} (${mbPerMinute.toFixed(1)} MB/min, minimum ${size.min})`,
        permanent: true,
      }
    if (size.max && mbPerMinute > size.max)
      return {
        reason: `too large for ${QUALITY_NAMES[quality]} (${mbPerMinute.toFixed(1)} MB/min, maximum ${size.max})`,
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

  'hardcoded-subs': ({ parsed, formatScore }) => {
    // allowed only when a custom format explicitly rewards them
    if (parsed.hardcodedSubs && formatScore <= 0)
      return { reason: 'has hardcoded subtitles', permanent: true }
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

  'episode-match': ({ parsed, target }) => {
    if (target.kind === 'movie') {
      if (parsed.kind === 'episode' || parsed.kind === 'season')
        return { reason: 'is a series release', permanent: true }
      return
    }
    const wanted = target.episodes
    if (!wanted) return
    const eps = parsed.episodes
    if (!eps) return { reason: 'has no episode information', permanent: true }
    if (eps.airDate) return // daily shows are matched by date in the library
    const seasons = eps.seasons ?? (eps.season !== undefined ? [eps.season] : [])
    if (seasons.length && !seasons.includes(wanted.season))
      return { reason: `is season ${seasons.join(', ')}, not ${wanted.season}`, permanent: true }
    if (target.kind === 'season') {
      if (parsed.kind !== 'season')
        return { reason: 'is a single episode, a season pack is wanted', permanent: true }
      return
    }
    if (parsed.kind === 'season')
      return { reason: 'is a season pack, single episodes are wanted', permanent: true }
    if (eps.numbers.length && !eps.numbers.some((n) => wanted.numbers.includes(n))) {
      return {
        reason: `is episode ${eps.numbers.join(', ')}, not ${wanted.numbers.join(', ')}`,
        permanent: true,
      }
    }
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
