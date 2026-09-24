import {
  AMBIGUOUS_LANGUAGE,
  AUDIO,
  EDITIONS,
  HDR,
  LANGUAGES,
  matchAll,
  matchRule,
  MODIFIERS,
  MULTI,
  RESOLUTIONS,
  SERVICES,
  SOURCES,
  VIDEO_CODECS,
} from './attributes'
import { findEpisodes } from './episodes'
import { any, B, E, Scanner } from './scanner'
import type { Flag, Hdr, ParsedRelease, ParseOptions, Revision } from './types'

const EXTENSION = /\.(?:mkv|mp4|m4v|avi|wmv|ts|m2ts|mov|webm|nzb|torrent|srt)$/i

/** Tags appended by trackers, re-posters and file hosts; never part of the release. */
const TRAILING_JUNK = [
  /\s*\[(?:rarbg|eztv(?:\.re)?|ettv|tgx|rartv|yts(?:\.[a-z]+)?|yify|publichd|eztvx(?:\.to)?|torrentgalaxy(?:\.to)?)\]$/i,
  /-(?:obfuscated|scrambled|postbot|xpost|asrequested|buymore|rakuv\w*|4p|chamele0n|nzbgeek|whiterev|sickbeard|nzbforyou)$/i,
  /\s*\[[0-9a-f]{8}\]$/i, // anime CRC32
]

/** Tokens that can end a title because they only appear in the release part of a name. */
const STOP = `${B}${any(
  '\\d{3,4}[pi]',
  '4k',
  'uhd',
  'blu-?ray',
  'bd-?rip',
  'br-?rip',
  'web-?(?:dl|rip)',
  'webdl',
  'webrip',
  'web',
  'hdtv',
  'pdtv',
  'dvd-?rip',
  'dvd(?:r|5|9)?',
  'hd-?cam',
  'cam-?rip',
  'hd-?ts',
  'telesync',
  'hd-?tc',
  'telecine',
  'remux',
  '[xh][ ]?26[45]',
  'hevc',
  'avc',
  'av1',
  'xvid',
  'divx',
  'proper',
  'repack',
  'rerip',
  'internal',
  'limited',
  'hdr(?:10)?(?:\\+|plus)?',
  'dovi',
  'hybrid',
  'complete',
  'dubbed',
  'subbed',
  'multi(?:\\d{0,2})?',
  'dual(?:[ -]?audio)?',
  'extended',
  'unrated',
  'uncut',
  'remastered',
  "director'?s[ -]?cut",
  'theatrical',
  'imax',
)}${E}`

const MAX_YEAR = new Date().getFullYear() + 1

const HDR_ORDER: Hdr[] = ['dv', 'hdr10plus', 'hdr10', 'hlg']

const LANGUAGE_WORD = new RegExp(`^(?:${LANGUAGES.map((rule) => rule.pattern).join('|')})$`, 'i')

function emptyRevision(): Revision {
  return { version: 1, real: 0, proper: false, repack: false }
}

export function parse(name: string, options: ParseOptions = {}): ParsedRelease {
  const input = name
  let trimmed = input.trim()
  let to = input.indexOf(trimmed) + trimmed.length

  // extension and trailing junk (repeat: `-GROUP-Obfuscated[rarbg].mkv`)
  for (let changed = true; changed;) {
    changed = false
    const before = trimmed
    trimmed = trimmed.replace(EXTENSION, '')
    for (const junk of TRAILING_JUNK) trimmed = trimmed.replace(junk, '')
    if (trimmed !== before) {
      to -= before.length - trimmed.length
      changed = true
    }
  }
  const start = input.indexOf(trimmed)

  const result: ParsedRelease = {
    input,
    title: '',
    kind: 'unknown',
    modifiers: [],
    revision: emptyRevision(),
    video: { hdr: [] },
    audio: { codecs: [] },
    languages: [],
    flags: [],
    spans: [],
  }

  if (
    !trimmed ||
    (/^[a-z0-9]{24,}$/i.test(trimmed.replace(/[._-]/g, '')) && !/[._ -]/.test(trimmed))
  ) {
    result.flags.push('obfuscated')
    result.languages = ['en']
    return result
  }

  const s = new Scanner(input, start, to)
  result.spans = s.spans
  let group: string | undefined

  // Anime layout: `[Group] Title - 12 (1080p) [CRC]`
  const anime = /^\[([^\]]+)\][ _.]*/.exec(input.slice(start, to))
  if (anime) {
    group = anime[1]!.trim()
    s.record('group', { start: start + 1, end: start + 1 + anime[1]!.length })
    s.from = start + anime[0].length
  }

  // ---- title anchors: episodes, year, first release-only token
  let episodeMatch = findEpisodes(s)
  const absolute = findAbsolute(s)
  if (
    absolute &&
    episodeMatch?.kind === 'season' &&
    episodeMatch.episodes.season !== undefined &&
    absolute.start >= episodeMatch.hit.end &&
    absolute.start - episodeMatch.hit.end <= 1
  ) {
    // anime `Title S2 - 04`: season 2, episode 4
    episodeMatch = {
      kind: 'episode',
      hit: { ...episodeMatch.hit, end: absolute.end },
      episodes: { season: episodeMatch.episodes.season, numbers: absolute.numbers },
    }
  } else if (absolute && (!episodeMatch || absolute.start < episodeMatch.hit.start)) {
    episodeMatch = {
      kind: 'episode',
      hit: { start: absolute.start, end: absolute.end, text: '', groups: [] },
      episodes: { numbers: [], absolute: absolute.numbers },
    }
    if (absolute.version > 1) result.revision.version = absolute.version
  }

  const firstWordEnd = firstWordEndAfter(s.norm, s.from)
  const stopHit = s.all(STOP).find((hit) => hit.start >= firstWordEnd)
  const qualityStart = stopHit?.start ?? to

  const episodeStart =
    episodeMatch && episodeMatch.hit.start >= firstWordEnd ? episodeMatch.hit.start : undefined
  if (episodeMatch && episodeStart === undefined) episodeMatch = undefined

  const yearLimit = Math.min(qualityStart, episodeStart ?? to)
  const years = s
    .all(`${B}\\(?((?:19|20)\\d{2})\\)?${E}`)
    .filter((hit) => hit.start >= firstWordEnd && hit.start <= yearLimit)
    .filter((hit) => Number(hit.groups[0]) <= MAX_YEAR)
    .filter(
      (hit) =>
        !episodeMatch || hit.end <= episodeMatch.hit.start || hit.start >= episodeMatch.hit.end,
    )
  const year = years.at(-1)

  let stop = Math.min(qualityStart, episodeStart ?? to, year?.start ?? to)

  // a capitalized language right before the stop belongs to the release: Title.GERMAN.1080p
  for (;;) {
    const words = [...s.norm.slice(s.from, stop).matchAll(/[A-Za-z]+/g)]
    const last = words.at(-1)
    if (!last || last.index! + s.from < firstWordEnd) break
    const word = last[0]
    if (word.length < 3 || word !== word.toUpperCase()) break
    if (!LANGUAGE_WORD.test(word)) break
    stop = s.from + last.index!
  }

  result.title = cleanTitle(input.slice(s.from, stop))
  s.record('title', { start: s.from, end: stop })

  if (year) {
    result.year = Number(year.groups[0])
    s.record('year', year)
  }
  if (episodeMatch) {
    result.episodes = episodeMatch.episodes
    result.kind = episodeMatch.kind
    if (episodeMatch.hit.end > episodeMatch.hit.start) s.record('episodes', episodeMatch.hit)
  }

  // ---- release attributes, all after the title
  const after = stop
  const resolution = matchRule(s, 'resolution', RESOLUTIONS, after)
  result.resolution = resolution?.value
  result.source = matchRule(s, 'source', SOURCES, after)?.value
  result.modifiers = [...new Set(matchAll(s, 'modifier', MODIFIERS, after).map((m) => m.value))]
  if (result.modifiers.includes('remux') || result.modifiers.includes('brdisk'))
    result.source ??= 'bluray'
  if (!result.resolution && s.first(`${B}uhd${E}`)) result.resolution = '2160p'

  result.video.codec = matchRule(s, 'videoCodec', VIDEO_CODECS, after)?.value
  const hdr = new Set(matchAll(s, 'hdr', HDR, after).map((m) => m.value))
  result.video.hdr = HDR_ORDER.filter((value) => hdr.has(value))
  const bitDepth = s.all(`${B}(?:(10|8)[ -]?bit|hi10p?)${E}`).find((h) => h.start >= after)
  if (bitDepth) {
    result.video.bitDepth = bitDepth.groups[0] === '8' ? 8 : 10
    s.record('bitDepth', bitDepth)
  }
  const threeD = s.all(`${B}(?:3d|h?sbs|h?ou)${E}`).find((h) => h.start >= after)
  if (threeD) {
    result.video.threeD = true
    s.record('3d', threeD)
  }

  const audio = matchAll(s, 'audio', AUDIO, after)
  result.audio.codecs = [...new Set(audio.map((a) => a.value))]
  const channels = s
    .all(`(?<![0-9])([1-9])[ ]([01])(?:ch)?(?![0-9])`)
    .find(
      (h) =>
        h.start >= after &&
        (audio.some((a) => h.start - a.end <= 3 && h.start >= a.end - 1) ||
          /^[257] [01]/.test(s.norm.slice(h.start, h.start + 3))),
    )
  if (channels) {
    result.audio.channels = `${channels.groups[0]}.${channels.groups[1]}`
    s.record('audioChannels', channels)
  }
  const atmos = s.all(`${B}(?:atmos(?![A-Za-z])|ddpa)`).find((h) => h.start >= after)
  if (atmos) {
    result.audio.atmos = true
    s.record('atmos', atmos)
  }

  // languages
  const languages = new Set<string>()
  for (const hit of matchAll(s, 'language', LANGUAGES, after)) {
    if (AMBIGUOUS_LANGUAGE.test(hit.text) && hit.text !== hit.text.toUpperCase()) continue
    // `FRA.UHD.Blu-ray` names the disc's region, not the audio language
    if (/^[ ](?:uhd[ ]?)?blu-?ray/i.test(s.norm.slice(hit.end, hit.end + 13))) continue
    languages.add(hit.value)
  }
  const multi = s.all(MULTI).find((h) => h.start >= after && isMultiTag(s.input, h))
  if (multi) {
    result.flags.push('multi-audio')
    s.record('multiAudio', multi)
    if (languages.size) languages.add('en')
  }
  result.languages = languages.size ? [...languages] : ['en']

  const edition = matchRule(s, 'edition', EDITIONS, after)
  if (edition) result.edition = edition.value

  // streaming service: the tags right before a WEB tag (`ATVP.PMTP.WEB-DL`); a known service
  // wins, otherwise the last capitalized tag
  const chain = s
    .all(`${B}((?:[A-Za-z]{2,8}[ ]){1,3})(?=web${E}|web-?(?:dl|rip)${E}|webdl|webrip)`)
    .find((h) => h.start >= after)
  if (chain) {
    const tags = chain.groups[0]!.trim().split(' ')
    const offset = (i: number) =>
      chain.start + tags.slice(0, i).reduce((n, t) => n + t.length + 1, 0)
    let index = tags.findIndex((tag) => SERVICES[tag.toLowerCase()])
    if (index < 0) {
      index = tags.length - 1
      if (!/^[A-Z]{2,5}$/.test(tags[index]!) || NOT_A_SERVICE.test(tags[index]!)) index = -1
    }
    if (index >= 0) {
      const tag = tags[index]!
      result.streamingService = SERVICES[tag.toLowerCase()] ?? tag.toLowerCase()
      s.record('streamingService', { start: offset(index), end: offset(index) + tag.length })
    }
  }

  // revision: PROPER, REPACK2, RERIP, REAL
  for (const hit of s.all(`${B}(proper|repack|rerip|real)([2-9])?${E}`)) {
    if (hit.start < after) continue
    const tag = hit.groups[0]!.toLowerCase()
    if (tag === 'real') {
      if (hit.groups[0] !== 'REAL') continue
      result.revision.real++
    } else {
      result.revision.version += hit.groups[1] ? Number(hit.groups[1]) : 1
      if (tag === 'proper') result.revision.proper = true
      else result.revision.repack = true
    }
    s.record('revision', hit)
  }

  // hardcoded subtitles
  const hc = s
    .all(`${B}(HC|hc[ -]?subs?|hardsub(?:s|bed)?|korsub(?:bed)?|hcsubbed)${E}`)
    .find((h) => h.start >= after && (!/^hc$/i.test(h.text) || h.text === 'HC'))
  if (hc) {
    result.hardcodedSubs = /korsub/i.test(hc.text) ? 'korsub' : 'hc'
    s.record('hardcodedSubs', hc)
  }

  // flags
  const flags: [Flag, string][] = [
    ['hybrid', 'hybrid'],
    ['internal', 'internal'],
    ['limited', 'limited'],
    ['sample', 'sample'],
    ['extras', any('extras', 'bonus', 'featurettes?', 'behind[ -]the[ -]scenes')],
    ['dubbed', 'dubbed'],
    ['subbed', 'subbed'],
  ]
  for (const [flag, pattern] of flags) {
    const hit =
      s.all(`${B}${pattern}${E}`).find((h) => h.start >= after) ??
      (flag === 'internal' ? s.all(`${B}iNT${E}`, 'g').find((h) => h.start >= after) : undefined)
    if (hit) {
      result.flags.push(flag)
      s.record(flag, hit)
    }
  }

  // group: `-GROUP` at the end, unless it came from an anime prefix
  if (!group) {
    const tail = /-([A-Za-z0-9]+)$/.exec(input.slice(0, to))
    if (tail) {
      const groupStart = to - tail[1]!.length
      if (groupStart > after && !NOT_A_GROUP.test(tail[1]!)) {
        group = tail[1]
        s.record('group', { start: groupStart, end: to })
      }
    }
  }
  result.group = group

  // without episode markers a name is a movie, unless the caller says it's a series
  if (result.kind === 'unknown' && options.kind !== 'series') {
    if (result.year || result.resolution || result.source) result.kind = 'movie'
  }
  result.spans.sort((a, b) => a.start - b.start)
  return result
}

/** Capitalized tags that can precede WEB but aren't services. */
const NOT_A_SERVICE =
  /^(?:uhd|hdr|sdr|dv|dual|multi|dl|proper|repack|internal|hybrid|remux|atmos|\d+)$/i

const NOT_A_GROUP =
  /^(?:dl|hd|rip|ray|x264|x265|h264|h265|264|265|ma|es|audio|sub|subs|dts|web|cut|rated|\d+)$/i

function isMultiTag(input: string, hit: { start: number; end: number; text: string }) {
  if (hit.text.toUpperCase() === 'DL') {
    // `DL` means dual language, except in WEB-DL
    if (hit.text !== 'DL') return false
    return !/web[ ._-]?$/i.test(input.slice(Math.max(0, hit.start - 4), hit.start))
  }
  return true
}

function findAbsolute(s: Scanner) {
  // `Title - 12`, `Title - 12v2`, `Title - 01-12` / `01 ~ 12`, followed by a bracket, paren or
  // end; or an anime batch `Title (01-12)`
  const hit =
    s.first(`[ ]-[ ](\\d{1,4})(?:v(\\d))?(?:[ ]?[-~][ ]?(\\d{1,4}))?(?=[ ]*(?:\\[|\\(|$))`) ??
    s.first(`[ ]\\((\\d{1,4})()[ ]?[-~][ ]?(\\d{1,4})\\)`)
  if (!hit) return
  const first = Number(hit.groups[0])
  const last = hit.groups[2] ? Number(hit.groups[2]) : first
  if (first >= 1900 && first <= 2100) return // a year, not an episode
  const numbers =
    last > first && last - first <= 200
      ? Array.from({ length: last - first + 1 }, (_, i) => first + i)
      : [first]
  return {
    start: hit.start,
    end: hit.end,
    numbers,
    version: hit.groups[1] ? Number(hit.groups[1]) : 1,
  }
}

function firstWordEndAfter(norm: string, from: number) {
  const m = /[^ \-[\]()]+/.exec(norm.slice(from))
  return m ? from + m.index + m[0].length : from
}

/** `The.Matrix` → `The Matrix`; keeps acronyms like `S.W.A.T.` and `R.J.`. */
export function cleanTitle(raw: string) {
  const words = raw.replace(/_/g, ' ').split(/[. ]+/).filter(Boolean)
  const out: string[] = []
  let acronym: string[] = []
  const flush = () => {
    if (acronym.length >= 2) out.push(acronym.join('.') + '.')
    else out.push(...acronym)
    acronym = []
  }
  for (const word of words) {
    if (/^[A-Za-z]$/.test(word)) acronym.push(word)
    else {
      flush()
      out.push(word)
    }
  }
  flush()
  return out
    .join(' ')
    .replace(/[\s\-([{]+$/, '')
    .replace(/^[\s\-)\]}]+/, '')
    .trim()
}
