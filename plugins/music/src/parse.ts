// Music release names: scene (`Artist-Album-(CAT001)-24BIT-WEB-FLAC-2026-GROUP`, underscores for
// spaces, dashes between parts) and P2P (`Artist - Album (2020) [FLAC 24-96] [WEB]`). Artist
// names may contain dashes (`Hi-Tek`), so `name` keeps everything before the tags and
// `artist`/`album` are only a guess; releases are matched against the known artist and album
// (see `matchAlbum`).

import type { BaseParsed } from '@magpiejs/decision'
import type { Revision } from '@magpiejs/parser'

export type AudioCodec = 'flac' | 'alac' | 'wav' | 'mp3' | 'aac' | 'opus' | 'vorbis'
export type ReleaseType = 'single' | 'ep' | 'album'

export interface ParsedMusic extends BaseParsed {
  kind: 'music'
  /** Everything before the tags, parts separated by ` - `. */
  name: string
  artist?: string
  album?: string
  year?: number
  codec?: AudioCodec
  /** 16 or 24 for lossless releases, when said. */
  bitDepth?: number
  /** kHz. */
  sampleRate?: number
  /** kbps, for lossy releases with a constant bitrate. */
  bitrate?: number
  /** LAME VBR preset: `v0`, `v2`. */
  vbr?: 'v0' | 'v2'
  source?: 'web' | 'cd' | 'vinyl' | 'tape' | 'radio' | 'dvd'
  /** Singles and EPs, when the name says so. */
  releaseType?: ReleaseType
  /** `2CD`, `3LP`. */
  discs?: number
  catalog?: string
  various: boolean
}

const LANGUAGE_CODES: Record<string, string> = {
  de: 'de',
  fr: 'fr',
  it: 'it',
  es: 'es',
  nl: 'nl',
  se: 'sv',
  dk: 'da',
  no: 'no',
  fi: 'fi',
  pl: 'pl',
  pt: 'pt',
  br: 'pt',
  ru: 'ru',
  jp: 'ja',
  kr: 'ko',
  cz: 'cs',
  hu: 'hu',
  gr: 'el',
  tr: 'tr',
  cn: 'zh',
  en: 'en',
  uk: 'en',
  us: 'en',
}

/** Words only found among the tags. */
const TAGS = new Set([
  'web',
  'cd',
  'cdm',
  'cds',
  'cdep',
  'cdr',
  'mcd',
  'ep',
  'lp',
  'vls',
  'vinyl',
  'sat',
  'cable',
  'dvb',
  'fm',
  'tape',
  'single',
  'promo',
  'reissue',
  'remastered',
  'remaster',
  'bootleg',
  'deluxe',
  'edition',
  'whitelabel',
  'split',
  'ost',
  'retail',
  'limited',
  'expanded',
  'bonus',
  'dvd',
  'bd',
  'flac',
  'mp3',
  'aac',
  'alac',
  'opus',
  'ogg',
  'vorbis',
  'wav',
  'lossless',
  'hires',
  'hi-res',
  'vbr',
  'cbr',
  'v0',
  'v2',
  '16bit',
  '24bit',
  '16b',
  '24b',
  'proper',
  'repack',
  'int',
  'dirfix',
  'nfofix',
  'readnfo',
  'mfsl',
  'sacd',
  'hdtracks',
  'itunes',
  'bandcamp',
  'qobuz',
  'tidal',
  'deezer',
  'spotify',
  'kbps',
  'khz',
  'double',
  'album',
])

const isYear = (w: string) => /^(?:19|20)\d{2}$/.test(w)

function isTag(word: string) {
  const w = word.toLowerCase()
  return (
    TAGS.has(w) ||
    /^\d+(?:cd|lp|dvd|bd|vinyl)$/.test(w) || // 2CD, 3LP, 2VINYL
    w === 'webflac' ||
    /^\d{2,3}(?:k|kbps)$/.test(w) || // 320k
    /^\d{2}(?:bit|b)$/.test(w) || // 24bit
    /^\d{2,3}(?:\.\d)?khz$/.test(w) || // 96kHz
    /^(?:16|24)(?:bit|b)?-\d{2,3}(?:\.\d)?(?:khz)?$/.test(w) // 24-96, 16B-44.1kHz
  )
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:,.]+|[\s\-–:,]+$/g, '')
    .trim()

export function parseMusic(input: string): ParsedMusic {
  const result: ParsedMusic = {
    input,
    title: '',
    name: '',
    kind: 'music',
    revision: { version: 1, real: 0, proper: false, repack: false } satisfies Revision,
    languages: [],
    flags: [],
    various: false,
  }
  const words: string[] = []
  let rest = input.trim()
  const scene = !/\s/.test(rest)
  let parts: string[]

  if (scene) {
    const group = /-([A-Za-z0-9_]+)$/.exec(rest)
    if (group && !isYear(group[1]!) && !isTag(group[1]!.replace(/_int$/i, ''))) {
      result.group = group[1]
      rest = rest.slice(0, group.index)
    }
    // parts are separated by dashes; `_-_` is a dash inside the name
    const segments = rest
      .replace(/_-_/g, '\uE000')
      // dashes inside parentheses belong to them: `(NSE141-01)`
      .replace(/\([^()]*\)/g, (p) => p.replace(/-/g, '\uE001'))
      .split('-')
    const name: string[] = []
    let tags = false
    for (const segment of segments) {
      const raw = segment.replace(/\uE001/g, '-')
      const text = raw
        .replace(/\uE000/g, ' - ')
        .replace(/_/g, ' ')
        .trim()
      if (!text) continue // `Avail--One_Wrench`
      const inner = /^\((.+)\)$/.exec(text)?.[1]
      const tokens = (inner ?? text).split(/[\s.]+/).filter(Boolean)
      const code = LANGUAGE_CODES[text.toLowerCase()]
      const tag =
        tokens.every((t) => isTag(t)) ||
        isYear(text) ||
        (tags && /^\d+$/.test(text)) || // dates after the tags: `SAT-09-23-2026`
        (!!code && name.length > 0 && /^[A-Z]{2}$/.test(text))
      if (tag && (name.length || isYear(text))) {
        tags = true
        if (code && !isTag(text)) result.languages.push(code)
        else words.push(...tokens)
        if (isYear(text)) result.year = Number(text)
        continue
      }
      // a catalog number after artist and album: `-KNTXT034-`
      if (name.length >= 2 && /^[A-Z]{2,}\d+[A-Z]?$/.test(raw)) {
        result.catalog = raw
        tags = true
        continue
      }
      // a catalog number in parentheses: `(RDI002)`
      if (inner && name.length && /\d/.test(inner) && /^\(\S+\)$/.test(raw)) {
        result.catalog = raw.slice(1, -1).replace(/_/g, ' ')
        tags = true
        continue
      }
      if (tags) continue
      name.push(text)
    }
    parts = name
      .flatMap((n) => n.split(' - '))
      .map(clean)
      .filter(Boolean)
  } else {
    // bracketed tags: `(2020)`, `[FLAC 24-96]`, `[WEB]`, `{320 kbps}`
    rest = rest.replace(/[[({]([^\])}]*)[\])}]/g, (bracketed: string, inner: string) => {
      const tokens = inner.split(/[\s,/|+&_]+/).filter(Boolean)
      if (tokens.length && tokens.every((t) => isTag(t) || isYear(t) || /^\d+(?:\.\d)?$/.test(t))) {
        words.push(...tokens)
        const year = tokens.find(isYear)
        if (year && tokens.length === 1) result.year ??= Number(year)
        return ' '
      }
      return ` ${bracketed} `
    })
    const group = /-([A-Za-z0-9]+)$/.exec(rest.trim())
    if (group && /\S-[A-Za-z0-9]+$/.test(rest.trim()) && !isTag(group[1]!) && !isYear(group[1]!)) {
      result.group = group[1]
      rest = rest.trim().slice(0, group.index)
    }
    // loose tags at the end: `Artist - Album 2020 FLAC`
    const tokens = rest.split(/\s+/).filter(Boolean)
    let end = tokens.length
    while (end > 1) {
      const t = tokens[end - 1]!
      if (isTag(t)) end--
      else if (isYear(t) && result.year === undefined && tokens[end - 2] !== '-') {
        result.year = Number(t)
        end--
      } else break
    }
    words.push(...tokens.slice(end))
    parts = clean(tokens.slice(0, end).join(' '))
      .split(/ [-–] /)
      .map(clean)
      .filter(Boolean)
  }

  // ---- what the tags say
  // `WEBFLAC` is two tags
  const expanded = words.flatMap((w) => (w.toLowerCase() === 'webflac' ? ['web', 'flac'] : [w]))
  words.splice(0, words.length, ...expanded)
  for (const [i, word] of words.entries()) {
    const w = word.toLowerCase()
    const next = words[i + 1]?.toLowerCase()
    if (w === 'flac' || w === 'lossless') result.codec = 'flac'
    else if (w === 'alac') result.codec = 'alac'
    else if (w === 'wav') result.codec = 'wav'
    else if (w === 'mp3') result.codec ??= 'mp3'
    else if (w === 'aac') result.codec ??= 'aac'
    else if (w === 'opus') result.codec ??= 'opus'
    else if (w === 'ogg' || w === 'vorbis') result.codec ??= 'vorbis'
    const depth = /^(16|24)(?:bit|b)?(?:-(\d{2,3}(?:\.\d)?)(?:khz)?)?$/.exec(w)
    if (depth && (w.includes('bit') || w.endsWith('b') || w.includes('-'))) {
      result.bitDepth = Number(depth[1])
      if (depth[2]) result.sampleRate = Number(depth[2])
    }
    const khz = /^(\d{2,3}(?:\.\d)?)khz$/.exec(w)
    if (khz) result.sampleRate = Number(khz[1])
    const kbps = /^(\d{2,3})(?:k|kbps)$/.exec(w) ?? (next === 'kbps' ? /^(\d{2,3})$/.exec(w) : null)
    if (kbps) result.bitrate = Number(kbps[1])
    if (
      /^\d{3}$/.test(w) &&
      (words[i - 1]?.toLowerCase() === 'mp3' || words[i - 1]?.toLowerCase() === 'aac')
    )
      result.bitrate = Number(w)
    if (w === 'v0' || w === 'v2') result.vbr = w
    if (
      w === 'web' ||
      ['itunes', 'bandcamp', 'qobuz', 'tidal', 'deezer', 'spotify', 'hdtracks'].includes(w)
    )
      result.source ??= 'web'
    else if (/^\d*(?:cd|cdm|cds|cdep|cdr|mcd)$/.test(w) || w === 'sacd') result.source ??= 'cd'
    else if (/^\d*(?:lp|vinyl)$/.test(w) || w === 'vls' || w === 'whitelabel')
      result.source ??= 'vinyl'
    else if (w === 'tape') result.source ??= 'tape'
    else if (w === 'sat' || w === 'cable' || w === 'dvb' || w === 'fm') result.source ??= 'radio'
    const discs = /^(\d+)(?:cd|lp|dvd|vinyl)$/.exec(w)
    if (discs) result.discs = Number(discs[1])
    if (w === 'single' || w === 'cdm' || w === 'cds' || w === 'vls') result.releaseType ??= 'single'
    if (w === 'ep' || w === 'cdep') result.releaseType ??= 'ep'
    if (w === 'proper') result.revision.proper = true
    if (w === 'repack') result.revision.repack = true
    if (w === 'remastered' || w === 'remaster') result.flags.push('remastered')
    if (w === 'promo') result.flags.push('promo')
    if (w === 'bootleg') result.flags.push('bootleg')
    if (w === 'deluxe') result.flags.push('deluxe')
  }
  // scene MP3 releases don't say MP3
  if (!result.codec && scene && result.group) result.codec = 'mp3'
  // a bitrate without a codec is MP3; `24-96` without one is lossless
  if (!result.codec && result.bitrate) result.codec = 'mp3'
  if (!result.codec && result.bitDepth) result.codec = 'flac'
  result.languages = [...new Set(result.languages)]
  if (!result.languages.length) result.languages = ['en']

  if (parts.length >= 2) {
    result.artist = parts[0]
    result.album = parts.slice(1).join(' - ')
  } else {
    result.album = parts[0]
  }
  result.various = /^(?:va|various(?: artists)?)$/i.test(result.artist ?? '')
  result.name = parts.join(' - ')
  result.title = result.album ?? ''
  return result
}

// ---- track files

export interface ParsedTrack {
  disc?: number
  track?: number
  title?: string
  artist?: string
}

/**
 * A track from a file's path inside a download: `01 - Title.flac`, `1-01 Title.mp3`, `101.
 * Title.mp3`, `CD2/03 Title.flac`, `Artist - 01 - Title.mp3`, `01-artist-title-group.mp3`,
 * `A1 - Title.flac` (vinyl side A). `discs` tells a three-digit `101` (disc 1, track 1) from
 * a track 101.
 */
export function parseTrackFile(path: string, discs = 1): ParsedTrack {
  const segments = path.split(/[\\/]/)
  const file = segments.pop()!.replace(/\.[a-z0-9]{2,4}$/i, '')
  const result: ParsedTrack = {}
  for (const dir of segments) {
    const disc = /^(?:cd|dis[ck]|disk|side)[\s._-]*(\d{1,2})\b/i.exec(dir.trim())
    if (disc) result.disc = Number(disc[1])
  }
  const scene = !/\s/.test(file) && /^\d{2,3}-/.test(file)
  if (scene) {
    // `01-artist_name-track_title-group`
    const [num, ...rest] = file.split('-')
    setNumber(result, num!, discs)
    if (rest.length >= 3) rest.pop() // the group
    const parts = rest.map((p) => p.replace(/_/g, ' ').trim()).filter(Boolean)
    if (parts.length >= 2) result.artist = parts[0]
    result.title = parts.at(-1)
    return result
  }
  // `1-01 Title`, `2.03 Title`
  const discTrack = /^(\d{1,2})[-.](\d{1,3})(?:\s*[-.]\s*|\s+)(.+)$/.exec(file)
  if (discTrack) {
    result.disc = Number(discTrack[1])
    result.track = Number(discTrack[2])
    result.title = discTrack[3]!.trim()
    return result
  }
  // vinyl sides: `A1 Title`, `B2 - Title`
  const side = /^([A-H])(\d{1,2})(?:\s*[-.]\s*|\s+)(.+)$/.exec(file)
  if (side) {
    result.disc = side[1]!.charCodeAt(0) - 64
    result.track = Number(side[2])
    result.title = side[3]!.trim()
    return result
  }
  const parts = file.split(/\s+[-–]\s+/).map((p) => p.trim())
  const numberAt = parts.findIndex((p) => /^\d{1,3}\.?$/.test(p) || /^\d{1,3}[.\s]/.test(p))
  if (numberAt >= 0) {
    const m = /^(\d{1,3})\.?\s*(.*)$/.exec(parts[numberAt]!)!
    setNumber(result, m[1]!, discs)
    const after = [m[2], ...parts.slice(numberAt + 1)].filter(Boolean).join(' - ')
    // `Artist - 01 - Title`, or `01 - Artist - Title` when the rest has two parts
    if (numberAt > 0) result.artist = parts.slice(0, numberAt).join(' - ')
    const afterParts = after.split(' - ')
    if (numberAt === 0 && afterParts.length === 2) {
      result.artist = afterParts[0]
      result.title = afterParts[1]
    } else result.title = after || undefined
    return result
  }
  const numbered = /^track\s*(\d{1,3})$/i.exec(file.trim())
  if (numbered) result.track = Number(numbered[1])
  else result.title = file.trim()
  return result
}

function setNumber(result: ParsedTrack, digits: string, discs: number) {
  const n = Number(digits)
  if (digits.length === 3 && discs > 1 && n % 100 > 0) {
    result.disc ??= Math.floor(n / 100)
    result.track = n % 100
  } else result.track = n
}
