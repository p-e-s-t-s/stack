export type Resolution = '480p' | '576p' | '720p' | '1080p' | '2160p'

export type Source =
  'cam' | 'telesync' | 'telecine' | 'workprint' | 'dvd' | 'hdtv' | 'webrip' | 'webdl' | 'bluray'

export type Modifier = 'remux' | 'brdisk' | 'rawhd' | 'regional' | 'screener'

export type VideoCodec = 'x264' | 'x265' | 'av1' | 'vc1' | 'mpeg2' | 'xvid'

export type Hdr = 'dv' | 'hdr10' | 'hdr10plus' | 'hlg'

export type AudioCodec =
  | 'truehd'
  | 'dtsx'
  | 'dtshdma'
  | 'dtshd'
  | 'dts'
  | 'ddp'
  | 'dd'
  | 'aac'
  | 'flac'
  | 'opus'
  | 'mp3'
  | 'pcm'

export type Flag =
  | 'hybrid'
  | 'internal'
  | 'limited'
  | 'obfuscated'
  | 'sample'
  | 'extras'
  | 'dubbed'
  | 'subbed'
  | 'multi-audio'

export interface Revision {
  /** 1 for an original release; each PROPER/REPACK/RERIP or `v2` raises it. */
  version: number
  /** Number of REAL tags (a REAL PROPER beats a PROPER). */
  real: number
  proper: boolean
  repack: boolean
}

export interface Episodes {
  /** Undefined for releases numbered without a season (anime, `E13`). */
  season?: number
  /** `[1, 2]` for S01E01E02; empty for a season pack. */
  numbers: number[]
  /** Absolute episode numbers (anime). */
  absolute?: number[]
  /** Daily shows, `YYYY-MM-DD`. */
  airDate?: string
  /** Seasons in a pack, e.g. `[1, 2, 3]` for S01-S03. */
  seasons?: number[]
  special?: boolean
}

export interface Span {
  field: string
  start: number
  end: number
  text: string
}

export interface ParsedRelease {
  input: string
  title: string
  year?: number
  kind: 'movie' | 'episode' | 'season' | 'unknown'
  episodes?: Episodes
  resolution?: Resolution
  source?: Source
  modifiers: Modifier[]
  revision: Revision
  video: {
    codec?: VideoCodec
    bitDepth?: 8 | 10
    hdr: Hdr[]
    threeD?: boolean
  }
  audio: {
    codecs: AudioCodec[]
    channels?: string
    atmos?: boolean
  }
  /** ISO 639-1 codes. Defaults to `['en']` when the name has no language tag. */
  languages: string[]
  edition?: string
  streamingService?: string
  group?: string
  hardcodedSubs?: string
  flags: Flag[]
  /** Which part of the input produced each field. */
  spans: Span[]
}

export interface ParseOptions {
  /** Hint used only to resolve ambiguous names. */
  kind?: 'movie' | 'series'
}
