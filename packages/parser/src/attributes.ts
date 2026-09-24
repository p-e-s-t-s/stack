// Table-driven matchers for everything after the title. Each rule is a pattern (matched on
// the separator-normalized name with letter/digit boundaries) and the value it produces.

import { any, B, E, type Scanner } from './scanner'
import type { AudioCodec, Hdr, Modifier, Resolution, Source, VideoCodec } from './types'

interface Rule<T> {
  pattern: string
  value: T
  /** Case-sensitive match (for short, ambiguous tags like `TS` or `DL`). */
  exact?: boolean
}

const w = (pattern: string) => `${B}${pattern}${E}`

export const RESOLUTIONS: Rule<Resolution>[] = [
  { pattern: w(any('2160[pi]', '4k', 'uhd[ -]?4k', '3840x2160')), value: '2160p' },
  { pattern: w(any('1080[pi]', '1920x1080', 'fhd')), value: '1080p' },
  { pattern: w(any('720p', '1280x720')), value: '720p' },
  { pattern: w('576[pi]'), value: '576p' },
  { pattern: w(any('480[pi]', '640x480', '848x480')), value: '480p' },
]

export const SOURCES: Rule<Source>[] = [
  {
    pattern: w(
      any(
        'blu-?ray',
        'bd-?rip',
        'br-?rip',
        'bd-?remux',
        'bdmv',
        'bd(?:25|50|66|100)',
        'uhd[ -]?bd',
      ),
    ),
    value: 'bluray',
  },
  { pattern: w(any('web-?rip', 'webrip')), value: 'webrip' },
  {
    pattern: w(any('web-?dl', 'webdl', 'web', 'web-?hd', 'amzn[ -]?web', 'itunes[ -]?hd')),
    value: 'webdl',
  },
  {
    pattern: w(
      any(
        'hdtv',
        'pdtv',
        'sdtv',
        'dsr(?:ip)?',
        'dthrip',
        'dvbrip',
        'tvrip',
        'hdtvrip',
        'ahdtv',
        'uhdtv',
      ),
    ),
    value: 'hdtv',
  },
  {
    pattern: w(
      any('dvd-?rip', 'dvd-?r', 'dvd(?:5|9)?', 'dvdivx', 'ntsc', 'pal', 'dvd-?scr', 'hd-?dvd'),
    ),
    value: 'dvd',
  },
  { pattern: w(any('hd-?cam', 'cam-?rip', 'cam')), value: 'cam' },
  { pattern: w(any('hd-?ts', 'telesync', 'pdvd', 'ts-?rip')), value: 'telesync' },
  { pattern: w('TS'), value: 'telesync', exact: true },
  { pattern: w(any('hd-?tc', 'telecine')), value: 'telecine' },
  { pattern: w('TC'), value: 'telecine', exact: true },
  { pattern: w(any('workprint', 'WP')), value: 'workprint' },
]

export const MODIFIERS: Rule<Modifier>[] = [
  { pattern: w(any('remux', 'bd-?remux')), value: 'remux' },
  {
    pattern: w(
      any('bdmv', 'bd(?:25|50|66|100)', 'complete[ -]?(?:uhd[ -]?)?blu-?ray', 'avc[ -]?hd', 'iso'),
    ),
    value: 'brdisk',
  },
  { pattern: w('raw-?hd'), value: 'rawhd' },
  { pattern: w(any('R5', 'R6')), value: 'regional', exact: true },
  { pattern: w(any('scr', 'screener', 'dvd-?scr', 'bd-?scr', 'web-?scr')), value: 'screener' },
]

export const VIDEO_CODECS: Rule<VideoCodec>[] = [
  { pattern: w(any('[xh][ ]?265', 'hevc')), value: 'x265' },
  { pattern: w(any('[xh][ ]?264', 'avc')), value: 'x264' },
  { pattern: w('av1'), value: 'av1' },
  { pattern: w('vc-?1'), value: 'vc1' },
  { pattern: w('mpeg-?2'), value: 'mpeg2' },
  { pattern: w(any('xvid', 'divx')), value: 'xvid' },
]

export const HDR: Rule<Hdr>[] = [
  { pattern: w(any('dv', 'dovi', 'dolby[ -]?vision')), value: 'dv' },
  { pattern: w(any('hdr10\\+', 'hdr10[ -]?plus', 'hdr10p')), value: 'hdr10plus' },
  { pattern: w(any('hdr10', 'hdr')), value: 'hdr10' },
  { pattern: w('hlg'), value: 'hlg' },
]

/** Audio tags can be glued to their channel count (`MA5.1`, `TrueHD7.1`, `DDP5.1`). */
const au = (pattern: string) => `${B}${pattern}(?![A-Za-z])`

export const AUDIO: Rule<AudioCodec>[] = [
  { pattern: au('true-?hd'), value: 'truehd' },
  { pattern: w(any('dts-?x', 'dts[ -]x')), value: 'dtsx' },
  { pattern: au(any('dts-?hd[ -]?ma', 'dts-?ma', 'dtshd-?ma')), value: 'dtshdma' },
  { pattern: au(any('dts-?hd(?:[ -]?hra)?', 'dts-?hra', 'dtshd')), value: 'dtshd' },
  { pattern: au('dts(?:-?es)?'), value: 'dts' },
  {
    pattern: `${B}${any('dd\\+', 'ddpa?', 'e-?ac-?3', 'dolby[ -]?digital[ -]?plus')}(?![A-Za-z])`,
    value: 'ddp',
  },
  { pattern: `${B}${any('dd', 'ac-?3', 'dolby[ -]?digital')}(?![A-Za-z+])`, value: 'dd' },
  { pattern: au('aac'), value: 'aac' },
  { pattern: au('flac'), value: 'flac' },
  { pattern: au('opus'), value: 'opus' },
  { pattern: au('mp3'), value: 'mp3' },
  { pattern: au('l?pcm'), value: 'pcm' },
]

/** Language tags, in scene/P2P spelling. `exact` tags are only trusted in capitals. */
export const LANGUAGES: Rule<string>[] = [
  { pattern: w(any('english', 'eng')), value: 'en' },
  { pattern: w(any('german', 'deutsch', 'ger')), value: 'de' },
  { pattern: w(any('french', 'truefrench', 'vff', 'vfq', 'vf2', 'fra', 'fre', 'fr')), value: 'fr' },
  { pattern: w(any('spanish', 'castellano', 'esp', 'latino')), value: 'es' },
  { pattern: w(any('italian', 'ita')), value: 'it' },
  { pattern: w(any('japanese', 'jpn', 'jap')), value: 'ja' },
  { pattern: w(any('korean', 'kor')), value: 'ko' },
  { pattern: w(any('chinese', 'mandarin', 'cantonese', 'chi')), value: 'zh' },
  { pattern: w(any('russian', 'rus')), value: 'ru' },
  { pattern: w(any('hindi', 'hin')), value: 'hi' },
  { pattern: w(any('portuguese', 'por', 'brazilian')), value: 'pt' },
  { pattern: w(any('dutch', 'flemish', 'nl')), value: 'nl' },
  { pattern: w(any('swedish', 'swe')), value: 'sv' },
  { pattern: w(any('norwegian', 'nor')), value: 'no' },
  { pattern: w(any('danish', 'dan')), value: 'da' },
  { pattern: w(any('finnish', 'fin')), value: 'fi' },
  { pattern: w(any('polish', 'pol', 'pl')), value: 'pl' },
  { pattern: w(any('turkish', 'tur')), value: 'tr' },
  { pattern: w(any('arabic', 'ara')), value: 'ar' },
  { pattern: w(any('czech', 'cze')), value: 'cs' },
  { pattern: w(any('hungarian', 'hun')), value: 'hu' },
  { pattern: w(any('greek', 'gre')), value: 'el' },
  { pattern: w(any('hebrew', 'heb')), value: 'he' },
  { pattern: w(any('thai', 'tha')), value: 'th' },
  { pattern: w(any('vietnamese', 'vie')), value: 'vi' },
  { pattern: w(any('ukrainian', 'ukr')), value: 'uk' },
  { pattern: w(any('tamil', 'tam')), value: 'ta' },
  { pattern: w(any('telugu', 'tel')), value: 'te' },
  { pattern: w(any('nordic')), value: 'nordic' },
]

/** Languages with a short ambiguous code only count when written in capitals. */
export const AMBIGUOUS_LANGUAGE =
  /^(?:eng|ger|fr|fra|fre|esp|ita|kor|chi|rus|hin|por|nl|nor|dan|fin|pol|pl|tur|ara|cze|hun|gre|heb|tha|vie|tel|tam|ukr|swe|jpn|jap)$/i

export const MULTI = w(any('multi', 'multi[0-9]{0,2}', 'dual(?:[ -]?audio)?', 'DL'))

export const EDITIONS: Rule<string>[] = [
  { pattern: w(`director'?s[ -]?cut`), value: "Director's Cut" },
  { pattern: w(`(?:extended|ultimate|special)[ -]?(?:cut|edition)`), value: '$0' },
  {
    pattern: w(
      `(?:collector'?s|anniversary|limited|deluxe|criterion)[ -]?(?:\\d+(?:th)?[ -]?)?edition`,
    ),
    value: '$0',
  },
  { pattern: w(`\\d+(?:th|st|nd|rd)?[ -]?anniversary(?:[ -]?edition)?`), value: '$0' },
  { pattern: w(`(?:european|us|uk|international)?[ -]?theatrical(?:[ -]?cut)?`), value: '$0' },
  { pattern: w(`final[ -]?cut`), value: 'Final Cut' },
  { pattern: w(`(?:imax(?:[ -]?enhanced)?)`), value: '$0' },
  { pattern: w(`(?:extended|unrated|uncut|uncensored)`), value: '$0' },
  { pattern: w(`(?:\\d+k[ -]?)?remastered`), value: '$0' },
  { pattern: w(`open[ -]?matte`), value: 'Open Matte' },
  { pattern: w(`criterion(?:[ -]?collection)?`), value: 'Criterion' },
  { pattern: w(`r-?rated`), value: 'R-Rated' },
  { pattern: w(`fan[ -]?edit`), value: 'Fan Edit' },
]

/** Streaming services are only trusted right before a WEB tag (or `WEB-DL`). */
export const SERVICES: Record<string, string> = {
  amzn: 'amzn',
  amazon: 'amzn',
  nf: 'nf',
  netflix: 'nf',
  dsnp: 'dsnp',
  dsny: 'dsnp',
  atvp: 'atvp',
  hmax: 'hmax',
  max: 'max',
  hulu: 'hulu',
  pcok: 'pcok',
  pmtp: 'pmtp',
  stan: 'stan',
  crav: 'crav',
  ip: 'ip',
  itvx: 'itvx',
  itv: 'itv',
  cr: 'cr',
  funi: 'funi',
  roku: 'roku',
  tubi: 'tubi',
  ma: 'ma',
  it: 'itunes',
  itunes: 'itunes',
  vudu: 'vudu',
  sho: 'sho',
  starz: 'starz',
  mubi: 'mubi',
  bcore: 'bcore',
  crit: 'crit',
  aubc: 'aubc',
  cbc: 'cbc',
  nlz: 'nlz',
  red: 'red',
  syfy: 'syfy',
  amc: 'amc',
  hbo: 'hbo',
}

interface Compiled<T> {
  /** One alternation per case mode; group i+1 belongs to rules[i]. */
  parts: { pattern: string; flags: string; rules: Rule<T>[] }[]
}

const compiled = new WeakMap<Rule<any>[], Compiled<any>>()

function compileTable<T>(rules: Rule<T>[]): Compiled<T> {
  let table = compiled.get(rules)
  if (!table) {
    const parts = [false, true].map((exact) => {
      const subset = rules.filter((rule) => !!rule.exact === exact)
      return {
        pattern: subset.map((rule) => `(${rule.pattern})`).join('|'),
        flags: exact ? 'g' : 'gi',
        rules: subset,
      }
    })
    table = { parts: parts.filter((part) => part.rules.length) }
    compiled.set(rules, table)
  }
  return table
}

interface TableHit<T> {
  value: T
  start: number
  end: number
  text: string
}

/** Every non-overlapping match of a rule table after `after`, earliest first. */
function scanTable<T>(s: Scanner, rules: Rule<T>[], after: number): TableHit<T>[] {
  const hits: TableHit<T>[] = []
  for (const part of compileTable(rules).parts) {
    for (const hit of s.all(part.pattern, part.flags)) {
      if (hit.start < after) continue
      const index = hit.groups.findIndex((g) => g !== undefined)
      const rule = part.rules[index]!
      if (hits.some((h) => h.start < hit.end && hit.start < h.end)) continue
      const value = (rule.value === '$0' ? cleanEdition(hit.text) : rule.value) as T
      hits.push({ value, start: hit.start, end: hit.end, text: hit.text })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

export function matchRule<T>(s: Scanner, field: string, rules: Rule<T>[], after = 0) {
  const best = scanTable(s, rules, after)[0]
  if (best) s.record(field, best)
  return best
}

export function matchAll<T>(s: Scanner, field: string, rules: Rule<T>[], after = 0) {
  const hits = scanTable(s, rules, after)
  for (const hit of hits) s.record(field, hit)
  return hits
}

function cleanEdition(text: string) {
  return text
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) =>
      /^\d+k$/i.test(word)
        ? word.toUpperCase()
        : word[0]!.toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ')
    .replace(/^Imax/, 'IMAX')
    .replace(/\bUs\b/, 'US')
    .replace(/\bUk\b/, 'UK')
}
