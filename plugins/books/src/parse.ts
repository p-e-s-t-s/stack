// Book release names: scene (`Author.Name.-.Title.2019.RETAIL.EPUB.eBook-GROUP`,
// `Author_-_Title-AUDiOBOOK-WEB-SE-2026-GROUP`) and P2P (`Author - Title (2019) [EPUB]`,
// `Title by Author [M4B] (Unabridged)`, `… read by Narrator`).
//
// Scene names often run the author into the title (`Stacia.Stark.A.Kingdom…`), so the parser
// doesn't guess where one ends: `name` is everything before the tags, and `author`/`title`
// are only set when the release separates them. Matching a release to a book is done with the
// author and title Magpie already knows (see `matchBook`).

import type { BaseParsed } from '@magpiejs/decision'
import type { Revision } from '@magpiejs/parser'

export type EbookFormat = 'epub' | 'azw3' | 'mobi' | 'pdf' | 'cbz' | 'cbr'
export type AudioFormat = 'm4b' | 'mp3' | 'flac'
export type BookFormat = EbookFormat | AudioFormat

export interface ParsedBook extends BaseParsed {
  kind: 'ebook' | 'audiobook' | 'unknown'
  /** Author and title as released, before tags. */
  name: string
  author?: string
  /** For `Author - Series 01 - Title`: `Series 01`. */
  series?: string
  year?: number
  formats: BookFormat[]
  retail: boolean
  /** `true` unabridged, `false` abridged, unset when not said. */
  unabridged?: boolean
  narrator?: string
  /** Audio bitrate in kbps. */
  bitrate?: number
}

const EBOOK_FORMATS: EbookFormat[] = ['epub', 'azw3', 'mobi', 'pdf', 'cbz', 'cbr']
const AUDIO_FORMATS: AudioFormat[] = ['m4b', 'mp3', 'flac']
const FORMAT_WORDS: Record<string, BookFormat> = {
  epub: 'epub',
  azw3: 'azw3',
  azw: 'azw3',
  kf8: 'azw3',
  mobi: 'mobi',
  pdf: 'pdf',
  cbz: 'cbz',
  cbr: 'cbr',
  m4b: 'm4b',
  mp3: 'mp3',
  flac: 'flac',
}

const LANGUAGES: Record<string, string> = {
  english: 'en',
  german: 'de',
  deutsch: 'de',
  french: 'fr',
  italian: 'it',
  spanish: 'es',
  dutch: 'nl',
  flemish: 'nl',
  swedish: 'sv',
  danish: 'da',
  norwegian: 'no',
  finnish: 'fi',
  polish: 'pl',
  portuguese: 'pt',
  russian: 'ru',
  czech: 'cs',
  hungarian: 'hu',
  japanese: 'ja',
}

/** Two-letter language/country codes in scene audiobook names (`-WEB-SE-2026-`). */
const COUNTRIES: Record<string, string> = {
  en: 'en',
  uk: 'en',
  us: 'en',
  de: 'de',
  fr: 'fr',
  it: 'it',
  es: 'es',
  nl: 'nl',
  se: 'sv',
  sv: 'sv',
  dk: 'da',
  da: 'da',
  no: 'no',
  fi: 'fi',
  pl: 'pl',
}

/** Words that only appear in the tags part of a name. */
const TAGS = new Set([
  'retail',
  'magazine',
  'ebook',
  'ebooks',
  'comic',
  'comics',
  'hybrid',
  'audiobook',
  'audiobooks',
  'abook',
  'web',
  'cd',
  'unabridged',
  'abridged',
  'proper',
  'repack',
  'readnfo',
  'nfofix',
  'kbps',
  'converted',
  'scan',
  'scanned',
  'ocr',
  'illustrated',
  'multiformat',
  'vbr',
  'cbr',
])

const isYear = (w: string) => /^(?:19|20)\d{2}$/.test(w)
const bitrateOf = (w: string) => /^(\d{2,3})k(?:bps)?$/i.exec(w)?.[1]

function isTag(word: string) {
  const w = word.toLowerCase()
  return (
    TAGS.has(w) || w in FORMAT_WORDS || w in LANGUAGES || !!bitrateOf(w) || /^v\d$/.test(w) // v2
  )
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, '')
    .trim()

export function parseBook(input: string): ParsedBook {
  const result: ParsedBook = {
    input,
    title: '',
    name: '',
    kind: 'unknown',
    formats: [],
    retail: false,
    revision: { version: 1, real: 0, proper: false, repack: false } satisfies Revision,
    languages: [],
    flags: [],
  }
  let rest = input.trim().replace(/\.(?:epub|mobi|azw3|pdf|cbz|cbr|m4b|mp3|flac|zip|rar)$/i, '')
  const words: string[] = [] // tag words found anywhere
  const setKind = (kind: ParsedBook['kind']) => {
    if (result.kind === 'unknown') result.kind = kind
  }

  // ---- scene names have no spaces; the group follows the last dash
  const scene = !/\s/.test(rest)
  if (scene) {
    const group = /-([A-Za-z0-9_]+)$/.exec(rest)
    if (group && !isYear(group[1]!) && !isTag(group[1]!)) {
      result.group = group[1]!
      rest = rest.slice(0, group.index)
    }
    // `Author_-_Title-AUDiOBOOK-WEB-SE-2026`: dashes separate segments; in dotted names
    // they're part of the title (`No.16-17`, `April-May`)
    const count = (c: string) => rest.split(c).length - 1
    const underscored = count('_') > count('.') || !rest.includes('.')
    rest = rest.replace(/_-_|\.-\./g, ' - ').replace(/[._]/g, ' ')
    const segments = underscored ? rest.split(/-(?! )|(?<! )-/) : [rest]
    if (segments.length > 1) {
      const name: string[] = []
      for (const [i, segment] of segments.entries()) {
        const s = segment.trim()
        const code = COUNTRIES[s.toLowerCase()]
        const tagSegment = isYear(s) || isTag(s) || (code && i > 0 && name.length > 0)
        if (tagSegment && name.length) {
          if (code && !isTag(s) && !isYear(s)) result.languages.push(code)
          else words.push(s)
          if (isYear(s)) result.year ??= Number(s)
          continue
        }
        name.push(s)
      }
      // `Author-Title` in a dash-only scene name
      rest = name.join(name.length === 2 && !name.some((n) => n.includes(' - ')) ? ' - ' : ' ')
    }
  } else {
    // ---- P2P: bracketed parts are tags, narrators or series
    rest = rest.replace(/[[({]([^\])}]*)[\])}]/g, (bracketed: string, inner: string) => {
      const text = inner.trim()
      const narrator = /^(?:read|narrated|narr\.?)(?: by)?\s+(.+)$/i.exec(text)
      if (narrator) {
        result.narrator = clean(narrator[1]!)
        return ' '
      }
      const parts = text.split(/[\s,/|+&]+/).filter(Boolean)
      if (parts.length && parts.every((p) => isTag(p) || isYear(p) || COUNTRIES[p.toLowerCase()])) {
        for (const p of parts) {
          const code = COUNTRIES[p.toLowerCase()]
          if (code && !isTag(p) && !isYear(p)) result.languages.push(code)
          else words.push(p)
          if (isYear(p)) result.year ??= Number(p)
        }
        return ' '
      }
      if (/^(?:eng|ger|fre|spa|ita)$/i.test(text)) {
        result.languages.push(
          { eng: 'en', ger: 'de', fre: 'fr', spa: 'es', ita: 'it' }[text.toLowerCase()]!,
        )
        return ' '
      }
      // `(Discworld #1)`, `(Book 2)`: series information, not the title
      if (/#\s*\d|\bbook \d|\bvol(?:ume)?\.? ?\d/i.test(text)) {
        result.series ??= clean(text)
        return ' '
      }
      return ` ${bracketed} `
    })
    const narrator = /\s(?:-\s*)?(?:read|narrated) by\s+(.+)$/i.exec(rest)
    if (narrator) {
      result.narrator ??= clean(narrator[1]!)
      rest = rest.slice(0, narrator.index)
    }
    // a group at the end: `… EPUB-GROUP`
    const group = /-([A-Za-z0-9]+)$/.exec(rest.trim())
    if (group && /[\s.]\S+-[A-Za-z0-9]+$/.test(rest.trim()) && !isTag(group[1]!)) {
      result.group = group[1]
      rest = rest.trim().slice(0, group.index)
    }
    rest = rest.replace(/_/g, ' ')
  }

  // ---- tags after the name: `Title 2019 RETAIL EPUB eBook`. Tag words can be part of a title
  // (`Image Comics - …`), so only the run of tags at the end counts, with one year in it.
  const tokens = rest.split(/\s+/).filter(Boolean)
  let end = tokens.length
  while (end > 1) {
    const token = tokens[end - 1]!.replace(/[.,]$/, '')
    if (isTag(token)) end--
    else if (isYear(token) && result.year === undefined && !/^[-–]$/.test(tokens[end - 2]!)) {
      result.year = Number(token)
      end--
    } else break
  }
  words.push(...tokens.slice(end))
  let name = clean(tokens.slice(0, end).join(' '))

  // ---- what the tags say
  for (const word of words) {
    const w = word.toLowerCase().replace(/[.,]$/, '')
    const format = FORMAT_WORDS[w]
    if (format && !result.formats.includes(format)) result.formats.push(format)
    if (w === 'retail') result.retail = true
    if (w === 'unabridged') result.unabridged = true
    if (w === 'abridged') result.unabridged ??= false
    if (w === 'proper') result.revision.proper = true
    if (w === 'repack') result.revision.repack = true
    if (LANGUAGES[w]) result.languages.push(LANGUAGES[w])
    if (isYear(w)) result.year ??= Number(w)
    const kbps = bitrateOf(w)
    if (kbps) result.bitrate = Number(kbps)
    if (w === 'comic' || w === 'comics') result.flags.push('comic')
    if (w === 'audiobook' || w === 'audiobooks' || w === 'abook') setKind('audiobook')
    if (w === 'ebook' || w === 'ebooks') setKind('ebook')
  }
  // `MP3 VBR`, `CD FLAC` in a scene audiobook: an MP3 unless said otherwise
  if (result.formats.some((f) => (AUDIO_FORMATS as string[]).includes(f))) setKind('audiobook')
  else if (result.formats.length) setKind('ebook')
  if (result.unabridged !== undefined || result.narrator || result.bitrate) setKind('audiobook')
  if (result.kind === 'audiobook' && !result.formats.length && scene) result.formats.push('mp3')
  // an audiobook's formats are audio ones (`cbr` is also "constant bitrate")
  if (result.kind === 'audiobook')
    result.formats = result.formats.filter((f) => (AUDIO_FORMATS as string[]).includes(f))
  if (result.kind === 'ebook')
    result.formats = result.formats.filter((f) => (EBOOK_FORMATS as string[]).includes(f))
  result.languages = [...new Set(result.languages)]
  if (!result.languages.length) result.languages = ['en']

  // ---- author and title, when the release separates them
  const parts = name
    .split(/ [-–] /)
    .map(clean)
    .filter(Boolean)
  if (parts.length >= 2) {
    result.author = parts[0]
    result.title = parts.at(-1)!
    if (parts.length > 2) result.series ??= parts.slice(1, -1).join(' - ')
  } else {
    const by = / by (?!.* by )(.+)$/i.exec(name)
    if (by && !scene) {
      result.author = clean(by[1]!)
      result.title = clean(name.slice(0, by.index))
      name = `${result.author} - ${result.title}`
    } else {
      result.title = name
    }
  }
  result.name = name
  return result
}

/** Best ebook format first, for picking a quality from a multi-format release. */
export const EBOOK_RANK: EbookFormat[] = ['epub', 'azw3', 'mobi', 'cbz', 'cbr', 'pdf']
export const AUDIO_RANK: AudioFormat[] = ['m4b', 'flac', 'mp3']
