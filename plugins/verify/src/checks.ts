// The built-in checks (docs/post-download-checks.md §2.3). Each looks at one finished download
// and returns the problems it finds; the policy decides what a problem means (off, warn, reject).

import type { Grab } from '@magpiejs/downloads'
import { findFiles, VIDEO_EXTENSIONS } from '@magpiejs/import'
import type { MediaItem } from '@magpiejs/library'
import { type ParsedRelease } from '@magpiejs/parser'
import type { ProbeFacts } from '@magpiejs/probe'
import { extname } from 'node:path'
import type { Mode, Policy } from './schema'

export interface Problem {
  reason: string
  detail?: unknown
}

export type ProbeOutcome = { facts: ProbeFacts } | { error: string }

export interface CheckContext {
  item: MediaItem
  grab: Grab
  parsed: ParsedRelease
  policy: Policy
  /** The download as the client reported it: a folder or a single file. */
  outputPath: string
  /** The files the kind would import, largest first. */
  files: { path: string; size: number }[]
  /**
   * The video files of `files` (the largest few), probed. Nothing for a file when ffprobe is
   * missing or timed out: probe-based checks are skipped, not failed.
   */
  probed: { path: string; size: number; result: ProbeOutcome }[]
  /** The metadata's runtime in minutes, when known. */
  runtimeMinutes?: number
}

export type CheckFn = (context: CheckContext) => Problem[] | Promise<Problem[]>

export interface CheckOptions {
  /** What a finding does unless the settings say otherwise. Default `warn`. */
  mode?: Mode
  /** The check reads ffprobe results, so it is skipped when ffprobe is unavailable. */
  needsProbe?: boolean
  label?: string
}

const name = (path: string) => path.split(/[\\/]/).pop() ?? path

const EXECUTABLES = new Set(['.exe', '.scr', '.bat', '.cmd', '.msi', '.lnk', '.vbs', '.js', '.jar'])

/** The classic fake-release payload: a "video" that is really a program. */
export const executable: CheckFn = async ({ outputPath }) => {
  const found = await findFiles(outputPath, EXECUTABLES)
  if (!found.length) return []
  const names = found.slice(0, 3).map((f) => name(f.path))
  return [
    {
      reason: `contains a program or script (${names.join(', ')}${found.length > 3 ? ', …' : ''})`,
      detail: { files: found.map((f) => name(f.path)) },
    },
  ]
}

const ARCHIVES = new Set(['.rar', '.zip', '.7z'])
// split archive volumes (`.r00`, `.z01`) have no single extension
for (let i = 0; i < 100; i++)
  for (const letter of ['r', 'z']) ARCHIVES.add(`.${letter}${String(i).padStart(2, '0')}`)

/** Nothing importable, only archives: unextracted, or protected by a password. */
export const noMedia: CheckFn = async ({ outputPath, files }) => {
  if (files.length || !(await findFiles(outputPath, ARCHIVES)).length) return []
  return [{ reason: 'only archives were downloaded (not extracted, or password protected)' }]
}

/** An empty file, or much less than the release said it would be. */
export const size: CheckFn = ({ grab, files }) => {
  if (files.some((f) => f.size === 0)) return [{ reason: 'a downloaded file is empty' }]
  const expected = grab.sizeBytes ?? grab.release.size
  if (!expected || expected < 50 * 1024 ** 2) return []
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total >= expected * 0.5) return []
  return [
    {
      reason: `the files are ${mb(total)} but the release was ${mb(expected)}`,
      detail: { total, expected },
    },
  ]
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`

/** ffprobe cannot read the file, or finds no video in it: corrupt or truncated. */
export const container: CheckFn = ({ probed }) => {
  const problems: Problem[] = []
  for (const { path, result } of probed) {
    if ('error' in result)
      problems.push({ reason: `${name(path)} is unreadable (${result.error})` })
    else if (!result.facts.video)
      problems.push({ reason: `${name(path)} has no video stream`, detail: result.facts.container })
  }
  return problems
}

/** The runtime is far from the metadata's. Longer cuts are fine for named editions. */
export const duration: CheckFn = ({ item, parsed, policy, runtimeMinutes, probed }) => {
  if (item.kind !== 'movie' || !runtimeMinutes || probed.length !== 1) return []
  const result = probed[0]?.result
  if (!result || !('facts' in result) || !result.facts.duration) return []
  const actual = result.facts.duration / 60
  const ratio = (actual - runtimeMinutes) / runtimeMinutes
  if (parsed.edition && ratio > 0) return []
  if (Math.abs(ratio) <= policy.durationTolerance) return []
  return [
    {
      reason: `runs ${Math.round(actual)} min but the movie is ${Math.round(runtimeMinutes)} min`,
      detail: { actual, runtimeMinutes },
    },
  ]
}

/** Widths a real release of each resolution reaches (letterboxed films are wide but short). */
const MIN_WIDTH: Record<string, number> = { '2160p': 3600, '1080p': 1800, '720p': 1200 }

/** The name says 1080p but the picture is smaller: a fake upscale label. */
export const resolution: CheckFn = ({ parsed, probed }) => {
  const min = parsed.resolution && MIN_WIDTH[parsed.resolution]
  if (!min) return []
  const problems: Problem[] = []
  for (const { path, result } of probed) {
    if (!('facts' in result) || !result.facts.video) continue
    const { width, height } = result.facts.video
    if (width < min)
      problems.push({
        reason: `${name(path)} is ${width}x${height}, not ${parsed.resolution}`,
        detail: { width, height },
      })
  }
  return problems
}

const CODECS: Record<string, string> = {
  x264: 'h264',
  x265: 'hevc',
  av1: 'av1',
  xvid: 'mpeg4',
  vc1: 'vc1',
  mpeg2: 'mpeg2video',
}

/** The name says x265 but the stream is x264. */
export const codec: CheckFn = ({ parsed, probed }) => {
  const claimed = parsed.video.codec
  const expected = claimed && CODECS[claimed]
  if (!expected) return []
  const problems: Problem[] = []
  for (const { path, result } of probed) {
    if (!('facts' in result) || !result.facts.video) continue
    const actual = result.facts.video.codec
    if (actual !== expected)
      problems.push({ reason: `${name(path)} is ${actual}, not ${claimed}`, detail: { actual } })
  }
  return problems
}

/** The name gave a language (`GERMAN`, `MULTi`) but no audio track is in one. */
export const audioLanguage: CheckFn = ({ parsed, probed }) => {
  if (!parsed.spans.some((s) => s.field === 'language')) return []
  const problems: Problem[] = []
  for (const { path, result } of probed) {
    if (!('facts' in result)) continue
    const languages = result.facts.audio.map((a) => a.language).filter(Boolean) as string[]
    // tracks without a language tag say nothing either way
    if (!languages.length) continue
    if (!languages.some((l) => parsed.languages.includes(l)))
      problems.push({
        reason: `${name(path)} has no ${parsed.languages.join('/')} audio (found ${languages.join(', ')})`,
        detail: { found: languages },
      })
  }
  return problems
}

/** Overall kilobits per second a release of each resolution stays above. */
const MIN_KBPS: Record<string, number> = { '2160p': 3000, '1080p': 1000, '720p': 500 }

/** Bitrate too low for the claimed resolution: a re-encode of something smaller. */
export const bitrate: CheckFn = ({ parsed, probed }) => {
  const min = parsed.resolution && MIN_KBPS[parsed.resolution]
  if (!min) return []
  const problems: Problem[] = []
  for (const { path, size, result } of probed) {
    if (!('facts' in result) || !result.facts.duration) continue
    const kbps = (size * 8) / result.facts.duration / 1000
    if (kbps < min)
      problems.push({
        reason: `${name(path)} averages ${Math.round(kbps)} kbps, too low for ${parsed.resolution}`,
        detail: { kbps },
      })
  }
  return problems
}

/** Whether a file is one the probe-based checks understand. */
export const probeable = (path: string) => VIDEO_EXTENSIONS.has(extname(path).toLowerCase())

export const BUILT_IN: { name: string; fn: CheckFn; options: CheckOptions }[] = [
  {
    name: 'executable',
    fn: executable,
    options: { mode: 'reject', label: 'Programs and scripts' },
  },
  { name: 'no-media', fn: noMedia, options: { mode: 'reject', label: 'Only archives' } },
  { name: 'size', fn: size, options: { label: 'Size' } },
  {
    name: 'container',
    fn: container,
    options: { mode: 'reject', needsProbe: true, label: 'Unreadable video' },
  },
  { name: 'duration', fn: duration, options: { needsProbe: true, label: 'Runtime' } },
  { name: 'resolution', fn: resolution, options: { needsProbe: true, label: 'Resolution' } },
  { name: 'codec', fn: codec, options: { needsProbe: true, label: 'Video codec' } },
  {
    name: 'audio-language',
    fn: audioLanguage,
    options: { needsProbe: true, label: 'Audio language' },
  },
  { name: 'bitrate', fn: bitrate, options: { needsProbe: true, label: 'Bitrate' } },
]
