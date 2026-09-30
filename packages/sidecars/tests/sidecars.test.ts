import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSidecars, sidecar, sidecarTarget } from '../src'

describe('sidecar', () => {
  it('matches the video name with one language suffix and flags', () => {
    expect(sidecar('/m/Movie.mkv', 'Movie.en.srt')).toMatchObject({ language: 'en', format: 'srt' })
    expect(sidecar('/m/Movie.mkv', 'movie.EN.forced.ass')).toMatchObject({
      language: 'en',
      forced: true,
    })
    expect(sidecar('/m/Movie.mkv', 'Movie.srt')).toMatchObject({ language: null })
    expect(sidecar('/m/Movie.mkv', 'Movie.en.sdh.vtt')).toMatchObject({ hi: true })
  })
  it('rejects other videos, several languages and non-subtitles', () => {
    expect(sidecar('/m/Movie.mkv', 'Movie.part2.en.srt')).toBeNull()
    expect(sidecar('/m/Movie.mkv', 'Movie 2.en.srt')).toBeNull()
    expect(sidecar('/m/Movie.mkv', 'Movie.en.nfo')).toBeNull()
    expect(sidecar('/m/Movie.mkv', 'Movie.en.fr.srt')).toBeNull()
  })
  it('never matches Magpie staging and backup files', () => {
    expect(sidecar('/m/Movie.mkv', '.magpie-1234.backup')).toBeNull()
    expect(sidecar('/m/Movie.mkv', '.magpie-1234.srt')).toBeNull()
    expect(sidecar('/m/Movie.mkv', 'Movie.en.srt.magpie-partial')).toBeNull()
  })
})

describe('findSidecars', () => {
  it('lists sidecars and the .sub of an .idx, and ignores the rest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-sidecars-'))
    for (const name of [
      'Movie.mkv',
      'Movie.en.srt',
      'Movie.fr.idx',
      'Movie.fr.sub',
      'Movie.nfo',
      'Other.en.srt',
      '.magpie-x.backup',
    ])
      writeFileSync(join(dir, name), 'x')
    expect(await findSidecars(join(dir, 'Movie.mkv'))).toEqual(
      ['Movie.en.srt', 'Movie.fr.idx', 'Movie.fr.sub'].map((n) => join(dir, n)),
    )
  })
  it('gives nothing for a missing folder', async () => {
    mkdirSync(join(tmpdir(), 'x'), { recursive: true })
    expect(await findSidecars('/nonexistent-magpie/Movie.mkv')).toEqual([])
  })
})

describe('sidecarTarget', () => {
  it('keeps the suffix when the video is renamed or moved', () => {
    expect(sidecarTarget('/a/Old.mkv', '/b/New.mkv', '/a/Old.en.forced.srt')).toBe(
      '/b/New.en.forced.srt',
    )
    expect(sidecarTarget('/a/Old.mkv', '/b/New.mkv', '/a/Old.fr.sub')).toBe('/b/New.fr.sub')
  })
})
