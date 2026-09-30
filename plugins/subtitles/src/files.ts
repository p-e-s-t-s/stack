import { createHash } from 'node:crypto'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { fingerprint, run } from '@magpiejs/probe'
import type { SubtitleFormat } from '@magpiejs/types'
import { language } from './policy'

export const MAX_SUBTITLE = 8 * 1024 * 1024
export const hashBytes = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export async function fileHash(path: string) {
  const info = await stat(path)
  if (info.size > MAX_SUBTITLE) throw new Error('subtitle is too large')
  return hashBytes(await readFile(path))
}
export function contained(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path))
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('path escapes the library directory')
  return resolve(path)
}
export async function safePath(root: string, path: string, mustExist = true) {
  contained(root, path)
  const realRoot = await realpath(root)
  try { contained(realRoot, await realpath(path)) }
  catch (error) {
    if (mustExist || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    contained(realRoot, resolve(await realpath(resolve(path, '..')), basename(path)))
  }
  return path
}
export { fingerprint, run }
/** OpenSubtitles hash: size plus first/last 64 KiB of little-endian 64-bit words. */
export async function movieHash(path: string) {
  const size = (await stat(path)).size
  if (size < 131072) return undefined
  const handle = await open(path, 'r')
  try {
    let hash = BigInt(size)
    for (const position of [0, size - 65536]) {
      const bytes = Buffer.alloc(65536)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, position)
      if (bytesRead !== bytes.length) throw new Error('media changed while hashing')
      for (let i = 0; i < bytes.length; i += 8) hash += bytes.readBigUInt64LE(i)
    }
    return BigInt.asUintN(64, hash).toString(16).padStart(16, '0')
  } finally { await handle.close() }
}
export function sidecar(video: string, name: string) {
  const base = basename(video, extname(video))
  const ext = extname(name).slice(1).toLowerCase()
  if (!['srt', 'ass', 'ssa', 'vtt', 'idx'].includes(ext)) return null
  const stem = name.slice(0, -(ext.length + 1))
  if (stem.toLowerCase() !== base.toLowerCase() && !stem.toLowerCase().startsWith(base.toLowerCase() + '.')) return null
  const tokens = stem.slice(base.length).replace(/^\./, '').split('.').filter(Boolean)
  const flags = new Set(tokens.map(t => t.toLowerCase()))
  const langTokens = tokens.filter(t => !['forced', 'hi', 'sdh', 'cc'].includes(t.toLowerCase()))
  // Accept one language suffix only: avoid associating Movie.part2.en.srt with Movie.mkv.
  if (langTokens.length > 1 || (langTokens.length && !language(langTokens[0]))) return null
  return { language: language(langTokens[0]), forced: flags.has('forced'), hi: flags.has('hi') || flags.has('sdh') || flags.has('cc'), format: ext }
}
export function decode(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_SUBTITLE) throw new Error('empty or oversized subtitle')
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  let text: string
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { throw new Error('subtitle encoding is ambiguous; convert to UTF-8 before importing') }
  if (text.includes('\0')) throw new Error('binary subtitle content')
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}
const TIME = /(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{2,3})/
function seconds(s: string) {
  const m = TIME.exec(s)
  if (!m || +m[2]! > 59 || +m[3]! > 59) throw new Error('invalid subtitle timestamp')
  return +(m[1] ?? 0) * 3600 + +m[2]! * 60 + +m[3]! + +m[4]! / (m[4]!.length === 2 ? 100 : 1000)
}
export interface Cue { start: number; end: number; text: string }
export function cues(text: string, format: SubtitleFormat): Cue[] {
  const result: Cue[] = []
  if (format === 'ass' || format === 'ssa') {
    // Respect the Events Format line (ASS and SSA differ).
    const eventSection = text.split(/\[Events\]/i)[1]?.split(/\n\[/)[0]
    const fields = /^Format:\s*(.+)$/im.exec(eventSection ?? '')?.[1]?.split(',').map(s => s.trim().toLowerCase())
    if (!fields || fields.indexOf('text') !== fields.length - 1) throw new Error('unsupported ASS/SSA event format')
    for (const line of (eventSection ?? '').split('\n')) {
      if (!/^Dialogue:/i.test(line)) continue
      const parts = line.replace(/^Dialogue:\s*/i, '').split(',')
      result.push({ start: seconds(parts[fields.indexOf('start')] ?? ''), end: seconds(parts[fields.indexOf('end')] ?? ''), text: parts.slice(fields.length - 1).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, ' ') })
    }
  } else {
    if (format === 'vtt' && !text.startsWith('WEBVTT')) throw new Error('invalid WebVTT header')
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n')
      const i = lines.findIndex(l => l.includes('-->'))
      if (i < 0) continue
      const [start, end] = lines[i]!.split('-->')
      result.push({ start: seconds(start!), end: seconds(end!), text: lines.slice(i + 1).join('\n').replace(/<[^>]*>/g, '') })
    }
  }
  return result
}
export function validateText(text: string, format: SubtitleFormat, duration?: number) {
  const parsed = cues(text, format)
  if (!parsed.length || parsed.length > 100_000 || !parsed.some(c => c.text.trim())) throw new Error('subtitle has no usable cues')
  if (parsed.some(c => c.end <= c.start || c.start < 0 || (duration && c.end > duration + 120))) throw new Error('subtitle timestamps are invalid or exceed media duration')
  return parsed
}
export function unpack(bytes: Uint8Array, format: SubtitleFormat): Uint8Array {
  if (bytes.length > MAX_SUBTITLE) throw new Error('subtitle download too large')
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return bytes
  let total = 0, count = 0
  const files = unzipSync(bytes, { filter(entry) {
    total += entry.originalSize; count++
    if (total > MAX_SUBTITLE || count > 100 || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(entry.name)) throw new Error('unsafe or oversized subtitle archive')
    return entry.name.toLowerCase().endsWith(`.${format}`)
  } })
  const members = Object.values(files)
  if (members.length !== 1) throw new Error('archive must contain exactly one matching subtitle')
  return members[0]!
}
export function shifted(text: string, format: SubtitleFormat, offset: number) {
  if (!Number.isFinite(offset) || Math.abs(offset) > 600) throw new Error('offset must be between -600 and 600 seconds')
  const timestamp = (value: string) => {
    const time = seconds(value) + offset
    if (time < 0) throw new Error('offset would create negative timestamps')
    const ass = format === 'ass' || format === 'ssa'
    const unit = ass ? 100 : 1000
    const ticks = Math.round(time * unit)
    const hours = Math.floor(ticks / (3600 * unit))
    const minutes = Math.floor(ticks / (60 * unit)) % 60
    const secs = Math.floor(ticks / unit) % 60
    const digits = String(ticks % unit).padStart(ass ? 2 : 3, '0')
    return `${String(hours).padStart(ass ? 1 : 2, '0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}${ass || format === 'vtt' ? '.' : ','}${digits}`
  }
  if (format === 'ass' || format === 'ssa') {
    const fields = /^Format:\s*(.+)$/im.exec(text.split(/\[Events\]/i)[1] ?? '')?.[1]?.split(',').map(s=>s.trim().toLowerCase())
    if (!fields) throw new Error('missing event format')
    return text.replace(/^Dialogue:.*$/gim, line => {
      const prefix = /^Dialogue:\s*/i.exec(line)![0]
      const values = line.slice(prefix.length).split(',')
      for (const key of ['start','end']) { const i = fields.indexOf(key); values[i] = timestamp(values[i]!) }
      return prefix + values.join(',')
    })
  }
  return text.replace(/^(.*?)(\d{1,3}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}\.\d{3})(\s*-->\s*)(\d{1,3}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}\.\d{3})(.*)$/gm, (_, a, start, arrow, end, rest) => a + timestamp(start) + arrow + timestamp(end) + rest)
}
