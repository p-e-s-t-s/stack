// Sidecar files: subtitles that sit next to a video and are named after it. Shared by the
// subtitles plugin (inventory) and import (which moves, replaces and undoes them with the video).

import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { normalizeLanguage } from '@magpiejs/probe'

export const SIDECAR_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt', 'idx'] as const

export interface SidecarInfo {
  language: string | null
  forced: boolean
  hi: boolean
  format: string
}

/**
 * Whether `name` (a file name in the video's folder) is a sidecar of `video`: the video's base
 * name, at most one language suffix plus forced/hi flags, and a subtitle extension. Dot-prefixed
 * staging and backup files never match.
 */
export function sidecar(video: string, name: string): SidecarInfo | null {
  const base = basename(video, extname(video))
  const ext = extname(name).slice(1).toLowerCase()
  if (!(SIDECAR_EXTENSIONS as readonly string[]).includes(ext)) return null
  const stem = name.slice(0, -(ext.length + 1))
  if (
    stem.toLowerCase() !== base.toLowerCase() &&
    !stem.toLowerCase().startsWith(base.toLowerCase() + '.')
  )
    return null
  const tokens = stem.slice(base.length).replace(/^\./, '').split('.').filter(Boolean)
  const flags = new Set(tokens.map((t) => t.toLowerCase()))
  const langTokens = tokens.filter((t) => !['forced', 'hi', 'sdh', 'cc'].includes(t.toLowerCase()))
  // Accept one language suffix only: avoid associating Movie.part2.en.srt with Movie.mkv.
  if (langTokens.length > 1 || (langTokens.length && !normalizeLanguage(langTokens[0]!)))
    return null
  return {
    language: normalizeLanguage(langTokens[0] ?? ''),
    forced: flags.has('forced'),
    hi: flags.has('hi') || flags.has('sdh') || flags.has('cc'),
    format: ext,
  }
}

/**
 * The absolute paths of a video's sidecars (and the `.sub` data file of each `.idx`), sorted.
 * A missing folder has none.
 */
export async function findSidecars(
  video: string,
  list: (dir: string) => Promise<string[]> = (dir) => readdir(dir),
): Promise<string[]> {
  const dir = dirname(video)
  let names: string[]
  try {
    names = await list(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: string[] = []
  for (const name of names) {
    const info = sidecar(video, name)
    if (!info) continue
    found.push(join(dir, name))
    if (info.format === 'idx') {
      const data = name.slice(0, -4) + '.sub'
      if (names.includes(data)) found.push(join(dir, data))
    }
  }
  return found.sort()
}

/** Where a sidecar of `from` goes when the video is renamed or moved to `to`. */
export function sidecarTarget(from: string, to: string, sidecarPath: string) {
  const suffix = basename(sidecarPath).slice(basename(from, extname(from)).length)
  return join(dirname(to), basename(to, extname(to)) + suffix)
}
