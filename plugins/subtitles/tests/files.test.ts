import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_SUBTITLE,
  contained,
  cues,
  decode,
  hashBytes,
  movieHash,
  safePath,
  shifted,
  sidecar,
  unpack,
  validateText,
} from '../src/files'

const SRT =
  '1\n00:00:01,000 --> 00:00:03,500\nHello\n\n2\n00:01:04,250 --> 00:01:06,000\n<i>World</i>\n'
const VTT = 'WEBVTT\n\n00:01.000 --> 00:03.500\nHello\n\n01:04.250 --> 01:06.000\nWorld\n'
const ASS = `[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\i1}Hello, there\\NFriend\n`
const bytes = (s: string) => new TextEncoder().encode(s)

let dir: string
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'magpie-files-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('sidecar', () => {
  const video = '/lib/Movie (2020)/Movie (2020).mkv'

  it('reads language, forced and hearing-impaired flags from the file name', () => {
    expect(sidecar(video, 'Movie (2020).en.srt')).toEqual({
      language: 'en',
      forced: false,
      hi: false,
      format: 'srt',
    })
    expect(sidecar(video, 'Movie (2020).fr.forced.ass')).toMatchObject({
      language: 'fr',
      forced: true,
      format: 'ass',
    })
    expect(sidecar(video, 'Movie (2020).en.sdh.srt')).toMatchObject({ hi: true })
    expect(sidecar(video, 'Movie (2020).en.CC.srt')).toMatchObject({ hi: true })
    expect(sidecar(video, 'MOVIE (2020).EN.SRT')).toMatchObject({ language: 'en', format: 'srt' })
  })

  it('accepts an untagged subtitle with an unknown language', () => {
    expect(sidecar(video, 'Movie (2020).srt')).toMatchObject({ language: null })
  })

  it.each([
    ['another movie', 'Other (2020).en.srt'],
    ['a longer name sharing the prefix', 'Movie (2020) Extras.en.srt'],
    ['a part number mistaken for a language', 'Movie (2020).part2.en.srt'],
    ['two language tags', 'Movie (2020).en.fr.srt'],
    ['an unknown language tag', 'Movie (2020).zzzz.srt'],
    ['an unsupported extension', 'Movie (2020).en.txt'],
    ['the video itself', 'Movie (2020).mkv'],
  ])('ignores %s', (_why, name) => {
    expect(sidecar(video, name)).toBeNull()
  })
})

describe('decode', () => {
  it('strips a BOM and normalises line endings', () => {
    expect(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes('a\r\nb\rc\n')]))).toBe(
      'a\nb\nc\n',
    )
  })

  it('reads UTF-16 with a BOM in either byte order', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')])
    const be = Buffer.from(le.subarray(2)).swap16()
    expect(decode(le)).toBe('héllo')
    expect(decode(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('héllo')
  })

  it('refuses ambiguous encodings, binary content, and empty or oversized input', () => {
    expect(() => decode(Buffer.from([0xe9, 0x74, 0xe9]))).toThrow('ambiguous') // latin-1
    expect(() => decode(bytes('a\0b'))).toThrow('binary')
    expect(() => decode(new Uint8Array())).toThrow('empty or oversized')
    expect(() => decode(new Uint8Array(MAX_SUBTITLE + 1))).toThrow('empty or oversized')
  })
})

describe('cues', () => {
  it('parses SRT, stripping markup', () => {
    expect(cues(SRT, 'srt').map((c) => ({ ...c, text: c.text.trim() }))).toEqual([
      { start: 1, end: 3.5, text: 'Hello' },
      { start: 64.25, end: 66, text: 'World' },
    ])
  })

  it('parses WebVTT, and requires its header', () => {
    expect(cues(VTT, 'vtt').map((c) => [c.start, c.end])).toEqual([
      [1, 3.5],
      [64.25, 66],
    ])
    expect(() => cues(SRT, 'vtt')).toThrow('invalid WebVTT header')
  })

  it('parses ASS dialogue by the declared field order, keeping commas in the text', () => {
    expect(cues(ASS, 'ass')).toEqual([{ start: 1, end: 3.5, text: 'Hello, there Friend' }])
  })

  it('rejects ASS whose text field is not last, and invalid timestamps', () => {
    expect(() => cues(ASS.replace('Effect, Text', 'Text, Effect'), 'ass')).toThrow('unsupported')
    expect(() => cues('1\n00:00:61,000 --> 00:00:62,000\nx\n', 'srt')).toThrow(
      'invalid subtitle timestamp',
    )
  })
})

describe('validateText', () => {
  it('returns the cues of a usable subtitle', () => {
    expect(validateText(SRT, 'srt', 120)).toHaveLength(2)
  })

  it.each([
    ['no cues', 'nothing here', 'no usable cues'],
    ['only blank cues', '1\n00:00:01,000 --> 00:00:02,000\n \n', 'no usable cues'],
    ['an end before its start', '1\n00:00:05,000 --> 00:00:02,000\nx\n', 'invalid or exceed'],
  ])('rejects %s', (_why, text, message) => {
    expect(() => validateText(text, 'srt')).toThrow(message)
  })

  it('rejects cues running well past the media duration, with two minutes of slack', () => {
    const text = (end: string) => `1\n00:00:01,000 --> ${end}\nx\n`
    expect(() => validateText(text('00:02:09,000'), 'srt', 10)).not.toThrow()
    expect(() => validateText(text('00:02:11,000'), 'srt', 10)).toThrow('exceed media duration')
  })
})

describe('shifted', () => {
  it('moves every SRT timestamp by the offset', () => {
    expect(shifted(SRT, 'srt', 2.5)).toBe(
      '1\n00:00:03,500 --> 00:00:06,000\nHello\n\n2\n00:01:06,750 --> 00:01:08,500\n<i>World</i>\n',
    )
    expect(shifted(SRT, 'srt', -1)).toContain('00:00:00,000 --> 00:00:02,500')
  })

  it('keeps the format-specific separators for WebVTT and ASS', () => {
    // short WebVTT timestamps come back in the (equally valid) long form
    expect(shifted(VTT, 'vtt', 1)).toContain('00:00:02.000 --> 00:00:04.500')
    expect(shifted(ASS, 'ass', 1)).toContain('Dialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,')
  })

  it('refuses offsets that are huge, non-finite, or push cues before zero', () => {
    expect(() => shifted(SRT, 'srt', 601)).toThrow('between -600 and 600')
    expect(() => shifted(SRT, 'srt', NaN)).toThrow('between -600 and 600')
    expect(() => shifted(SRT, 'srt', -2)).toThrow('negative timestamps')
  })
})

describe('unpack', () => {
  it('returns plain subtitles untouched', () => {
    const plain = bytes(SRT)
    expect(unpack(plain, 'srt')).toBe(plain)
  })

  it('extracts the single matching file from a zip', () => {
    const zip = zipSync({ 'readme.txt': bytes('hi'), 'movie.srt': bytes(SRT) })
    expect(new TextDecoder().decode(unpack(zip, 'srt'))).toBe(SRT)
  })

  it('refuses archives with no match, several matches, or unsafe paths', () => {
    expect(() => unpack(zipSync({ 'a.txt': bytes('x') }), 'srt')).toThrow('exactly one')
    expect(() => unpack(zipSync({ 'a.srt': bytes(SRT), 'b.srt': bytes(SRT) }), 'srt')).toThrow(
      'exactly one',
    )
    for (const name of ['../evil.srt', '/abs.srt', 'C:\\x.srt', 'a/../../b.srt'])
      expect(() => unpack(zipSync({ [name]: bytes(SRT) }), 'srt')).toThrow('unsafe')
  })

  it('refuses a zip bomb and archives with too many entries', () => {
    const big = zipSync({ 'a.srt': new Uint8Array(MAX_SUBTITLE + 1) })
    expect(big.length).toBeLessThan(MAX_SUBTITLE) // compresses small, expands large
    expect(() => unpack(big, 'srt')).toThrow('unsafe or oversized')
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`${i}.txt`, bytes('x')]))
    expect(() => unpack(zipSync(many), 'srt')).toThrow('unsafe or oversized')
  })
})

describe('path containment', () => {
  it('allows paths inside the root and refuses the root itself and anything outside', () => {
    expect(contained('/lib', '/lib/a/b.srt')).toBe('/lib/a/b.srt')
    for (const path of ['/lib', '/lib/../etc/passwd', '/libx/a', '/other'])
      expect(() => contained('/lib', path)).toThrow('escapes')
  })

  it('refuses a symlink that leads out of the root', async () => {
    const root = join(dir, 'lib')
    const outside = join(dir, 'outside')
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.srt'), SRT)
    symlinkSync(outside, join(root, 'link'))
    writeFileSync(join(root, 'ok.srt'), SRT)
    await expect(safePath(root, join(root, 'ok.srt'))).resolves.toBe(join(root, 'ok.srt'))
    await expect(safePath(root, join(root, 'link', 'secret.srt'))).rejects.toThrow('escapes')
  })

  it('lets a new file be created in an existing folder only when asked to', async () => {
    const root = join(dir, 'lib')
    mkdirSync(root)
    await expect(safePath(root, join(root, 'new.srt'))).rejects.toThrow() // must exist
    await expect(safePath(root, join(root, 'new.srt'), false)).resolves.toBe(join(root, 'new.srt'))
    await expect(safePath(root, join(root, 'missing', 'new.srt'), false)).rejects.toThrow()
  })
})

describe('movieHash', () => {
  it('skips files too small to hash', async () => {
    const path = join(dir, 'small.mkv')
    writeFileSync(path, Buffer.alloc(1000))
    expect(await movieHash(path)).toBeUndefined()
  })

  it('is the file size when the content is all zeroes, and changes with the content', async () => {
    const path = join(dir, 'a.mkv')
    writeFileSync(path, Buffer.alloc(200_000))
    expect(await movieHash(path)).toBe((200_000).toString(16).padStart(16, '0'))
    const other = Buffer.alloc(200_000)
    other.writeBigUInt64LE(5n, 0)
    writeFileSync(path, other)
    expect(await movieHash(path)).toBe((200_005).toString(16).padStart(16, '0'))
  })
})

it('hashes bytes and strings alike with sha256', () => {
  expect(hashBytes('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(hashBytes(bytes('abc'))).toBe(hashBytes('abc'))
})
