import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { normalizeLanguage } from './language'

export type Hdr = 'dv' | 'hdr10' | 'hdr10plus' | 'hlg'

export interface VideoFacts {
  codec: string
  profile?: string
  width: number
  height: number
  bitDepth?: number
  frameRate?: number
  /** Bits per second, when the stream reports it. */
  bitrate?: number
  hdr: Hdr[]
}

export interface AudioFacts {
  index: number
  codec: string
  /** `truehd`, `eac3`… with the `Atmos` hint ffprobe gives in the profile, when present. */
  profile?: string
  channels?: number
  layout?: string
  language: string | null
  title?: string
  default: boolean
}

export interface SubtitleFacts {
  index: number
  codec: string
  language: string | null
  forced: boolean | null
  hi: boolean | null
}

export interface ProbeFacts {
  /** Seconds. */
  duration?: number
  /** ffprobe's format name, e.g. `matroska,webm`. */
  container?: string
  /** Overall bits per second. */
  bitrate?: number
  video?: VideoFacts
  audio: AudioFacts[]
  subtitles: SubtitleFacts[]
}

const MAX_OUTPUT = 16 * 1024 * 1024

/**
 * Runs a media tool and returns its stdout. Failures never expose the command line or the
 * tool's stderr, which can contain paths; callers get a short message.
 */
export function run(
  binary: string,
  args: string[],
  signal?: AbortSignal,
  timeout = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { signal, timeout, maxBuffer: MAX_OUTPUT, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              signal?.aborted
                ? 'operation cancelled'
                : `media tool failed (${(error as NodeJS.ErrnoException).code ?? 'timeout or invalid output'})`,
            ),
          )
        } else resolve(stdout)
      },
    )
  })
}

const num = (value: unknown) => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function frameRate(value: unknown) {
  if (typeof value !== 'string') return
  const [a, b] = value.split('/').map(Number)
  if (!a || !b) return
  return Math.round((a / b) * 1000) / 1000
}

function bitDepth(stream: any) {
  const raw = num(stream.bits_per_raw_sample)
  if (raw) return raw
  const match = /p(\d{2})(?:le|be)?$/.exec(stream.pix_fmt ?? '')
  return match ? Number(match[1]) : undefined
}

function hdrOf(stream: any): Hdr[] {
  const out: Hdr[] = []
  const side: string[] = (stream.side_data_list ?? []).map((d: any) => String(d.side_data_type))
  if (side.some((s) => /DOVI|Dolby Vision/i.test(s))) out.push('dv')
  if (stream.color_transfer === 'smpte2084') {
    out.push(side.some((s) => /SMPTE2094-40/i.test(s)) ? 'hdr10plus' : 'hdr10')
  } else if (stream.color_transfer === 'arib-std-b67') out.push('hlg')
  return out
}

/** Turns ffprobe's `-of json` output into facts. Pure: no I/O. */
export function parseProbe(json: any): ProbeFacts {
  if (!json || !Array.isArray(json.streams))
    throw new Error('probe did not return stream inventory')
  const streams: any[] = json.streams
  const facts: ProbeFacts = { audio: [], subtitles: [] }
  facts.duration = num(json.format?.duration)
  facts.bitrate = num(json.format?.bit_rate)
  if (typeof json.format?.format_name === 'string') facts.container = json.format.format_name

  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (video) {
    facts.video = {
      codec: video.codec_name ?? 'unknown',
      profile: video.profile || undefined,
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      bitDepth: bitDepth(video),
      frameRate: frameRate(video.avg_frame_rate) ?? frameRate(video.r_frame_rate),
      bitrate: num(video.bit_rate),
      hdr: hdrOf(video),
    }
  }
  for (const s of streams) {
    if (s.codec_type === 'audio') {
      facts.audio.push({
        index: s.index,
        codec: s.codec_name ?? 'unknown',
        profile: s.profile || undefined,
        channels: num(s.channels),
        layout: s.channel_layout || undefined,
        language: normalizeLanguage(s.tags?.language),
        title: s.tags?.title || undefined,
        default: !!s.disposition?.default,
      })
    } else if (s.codec_type === 'subtitle') {
      facts.subtitles.push({
        index: s.index,
        codec: s.codec_name ?? 'unknown',
        language: normalizeLanguage(s.tags?.language),
        forced: typeof s.disposition?.forced === 'number' ? !!s.disposition.forced : null,
        hi:
          typeof s.disposition?.hearing_impaired === 'number'
            ? !!s.disposition.hearing_impaired
            : null,
      })
    }
  }
  return facts
}

/** Probes a media file with ffprobe. */
export async function probe(
  path: string,
  binary: string,
  signal?: AbortSignal,
): Promise<ProbeFacts> {
  const output = await run(
    binary,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    signal,
  )
  let json: unknown
  try {
    json = JSON.parse(output)
  } catch {
    throw new Error('probe did not return valid output')
  }
  return parseProbe(json)
}

/**
 * Identifies one version of a file: if it changes, facts gathered earlier no longer apply.
 * Hardlinks share it with their source (same size, mtime and inode).
 */
export async function fingerprint(path: string) {
  const s = await stat(path)
  if (!s.isFile()) throw new Error('media path is not a file')
  return `${s.size}:${s.mtimeMs}:${s.ino}`
}
