// Quality families (docs/phase-4.5.md §3.2): each kind of media judges releases with the
// qualities, parser and rules of its family. Video (movies and TV) is built in; kind plugins
// register others (audio, ebook, audiobook) with `ctx.decision.family()`.

import { type ParsedRelease, parse, type Revision } from '@magpiejs/parser'
import type { ProfileItem } from './schema'
import { QUALITIES, QUALITY_NAMES, type Quality, qualityOf } from './qualities'
import { type Rule } from './rules'

/** What every family's parser returns; families add their own fields. */
export interface BaseParsed {
  input: string
  title: string
  /** What the release is, in the family's terms (`movie`, `episode`, `album`…). */
  kind: string
  revision: Revision
  /** ISO 639-1 codes. */
  languages: string[]
  group?: string
  flags: string[]
}

export interface FamilyCondition<P extends BaseParsed> {
  label: string
  /** Suggested values, shown as a list in the custom format editor. */
  values?: string[]
  test(parsed: P, value: string): boolean
}

export interface DefaultProfile {
  name: string
  items: ProfileItem[]
  /** A quality id, or a group name from `items`. */
  cutoff: string
  languages?: string[]
}

export interface QualityFamily<P extends BaseParsed = BaseParsed> {
  id: string
  /** Shown in the web console, e.g. `Video`. */
  label: string
  /** Worst to best. Ids must be unique across families. */
  qualities: { id: string; name: string }[]
  parse(title: string, hint?: { kind?: string }): P
  qualityOf(parsed: P): string
  /** How size limits are read: MB per minute of runtime, MB in total, or not at all. */
  sizeRule: 'perMinute' | 'total' | 'none'
  /** Minimum sizes for new installs, by quality (in the family's size unit). */
  defaultSizes?: Record<string, number>
  /** Profiles created the first time the family is registered. */
  defaultProfiles: DefaultProfile[]
  /** Custom format conditions only this family understands. */
  conditions?: Record<string, FamilyCondition<P>>
  /** Rules that only apply to releases of this family. */
  rules?: Record<string, Rule>
}

/** Builds profile items worst to best from a family's qualities, grouping some. */
export function profileItems(
  qualities: readonly string[],
  allowed: readonly string[],
  groups: { name: string; qualities: string[] }[] = [],
) {
  const result: ProfileItem[] = []
  for (const quality of qualities) {
    const group = groups.find((g) => g.qualities.includes(quality))
    if (group) {
      if (group.qualities[0] === quality) {
        result.push({
          name: group.name,
          qualities: group.qualities,
          allowed: group.qualities.some((q) => allowed.includes(q)),
        })
      }
      continue
    }
    result.push({ quality, allowed: allowed.includes(quality) })
  }
  return result
}

// ---- video

const MIN_SIZE: Partial<Record<Quality, number>> = {
  'webdl-480p': 1,
  'webrip-480p': 1,
  'bluray-480p': 1,
  'hdtv-720p': 3,
  'webrip-720p': 3,
  'webdl-720p': 3,
  'bluray-720p': 4,
  'hdtv-1080p': 5,
  'webrip-1080p': 5,
  'webdl-1080p': 5,
  'bluray-1080p': 7,
  'remux-1080p': 15,
  'hdtv-2160p': 15,
  'webrip-2160p': 15,
  'webdl-2160p': 15,
  'bluray-2160p': 20,
  'remux-2160p': 35,
}

const WEB_GROUPS = [
  { name: 'WEB 720p', qualities: ['webrip-720p', 'webdl-720p'] },
  { name: 'WEB 1080p', qualities: ['webrip-1080p', 'webdl-1080p'] },
  { name: 'WEB 2160p', qualities: ['webrip-2160p', 'webdl-2160p'] },
]

export const VIDEO_PROFILES: DefaultProfile[] = [
  {
    name: 'Any',
    items: profileItems(
      QUALITIES,
      QUALITIES.filter((q) => q !== 'unknown'),
      WEB_GROUPS,
    ),
    cutoff: 'WEB 1080p',
  },
  {
    name: 'HD',
    items: profileItems(
      QUALITIES,
      [
        'hdtv-720p',
        'webrip-720p',
        'webdl-720p',
        'bluray-720p',
        'hdtv-1080p',
        'webrip-1080p',
        'webdl-1080p',
        'bluray-1080p',
      ],
      WEB_GROUPS,
    ),
    cutoff: 'bluray-1080p',
  },
  {
    name: 'Ultra HD',
    items: profileItems(
      QUALITIES,
      ['hdtv-2160p', 'webrip-2160p', 'webdl-2160p', 'bluray-2160p', 'remux-2160p'],
      WEB_GROUPS,
    ),
    cutoff: 'remux-2160p',
  },
]

const is = (a: unknown, b: string) => a === b

/** A case-insensitive regex; an invalid pattern matches nothing. */
export function safeRegex(pattern: string) {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return /(?!)/
  }
}

export const videoFamily: QualityFamily<ParsedRelease> = {
  id: 'video',
  label: 'Video',
  qualities: QUALITIES.map((id) => ({ id, name: QUALITY_NAMES[id] })),
  parse: (title, hint) => parse(title, hint?.kind === 'series' ? { kind: 'series' } : {}),
  qualityOf,
  sizeRule: 'perMinute',
  defaultSizes: MIN_SIZE,
  defaultProfiles: VIDEO_PROFILES,
  conditions: {
    edition: {
      label: 'Edition (regex)',
      test: (p, v) => !!p.edition && safeRegex(v).test(p.edition),
    },
    source: {
      label: 'Source',
      values: [
        'cam',
        'telesync',
        'telecine',
        'workprint',
        'dvd',
        'hdtv',
        'webrip',
        'webdl',
        'bluray',
      ],
      test: (p, v) => is(p.source, v),
    },
    resolution: {
      label: 'Resolution',
      values: ['480p', '576p', '720p', '1080p', '2160p'],
      test: (p, v) => is(p.resolution, v),
    },
    modifier: {
      label: 'Modifier',
      values: ['remux', 'brdisk', 'rawhd', 'regional', 'screener'],
      test: (p, v) => p.modifiers.includes(v as never),
    },
    hdr: {
      label: 'HDR',
      values: ['dv', 'hdr10plus', 'hdr10', 'hlg'],
      test: (p, v) => p.video.hdr.includes(v as never),
    },
    videoCodec: {
      label: 'Video codec',
      values: ['x264', 'x265', 'av1', 'vc1', 'mpeg2', 'xvid'],
      test: (p, v) => is(p.video.codec, v),
    },
    audioCodec: {
      label: 'Audio codec',
      values: [
        'truehd',
        'dtsx',
        'dtshdma',
        'dtshd',
        'dts',
        'ddp',
        'dd',
        'aac',
        'flac',
        'opus',
        'mp3',
        'pcm',
      ],
      test: (p, v) => p.audio.codecs.includes(v as never),
    },
    streamingService: {
      label: 'Streaming service',
      test: (p, v) => is(p.streamingService, v),
    },
  },
  rules: {
    'hardcoded-subs': ({ parsed, formatScore }) => {
      // allowed only when a custom format explicitly rewards them
      if ((parsed as ParsedRelease).hardcodedSubs && formatScore <= 0)
        return { reason: 'has hardcoded subtitles', permanent: true }
    },
    'episode-match': ({ parsed: base, target }) => {
      const parsed = base as ParsedRelease
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
  },
}
