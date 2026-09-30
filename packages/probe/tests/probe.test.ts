import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fingerprint, normalizeLanguage, parseProbe, probe } from '../src'

const SAMPLE = {
  format: { format_name: 'matroska,webm', duration: '6720.512000', bit_rate: '45000000' },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'hevc',
      profile: 'Main 10',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p10le',
      avg_frame_rate: '24000/1001',
      color_transfer: 'smpte2084',
      side_data_list: [{ side_data_type: 'DOVI configuration record' }],
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'truehd',
      profile: 'Dolby TrueHD + Dolby Atmos',
      channels: 8,
      channel_layout: '7.1',
      tags: { language: 'eng', title: 'Atmos' },
      disposition: { default: 1 },
    },
    {
      index: 2,
      codec_type: 'audio',
      codec_name: 'ac3',
      channels: 6,
      tags: { language: 'fre' },
      disposition: { default: 0 },
    },
    {
      index: 3,
      codec_type: 'subtitle',
      codec_name: 'subrip',
      tags: { language: 'eng' },
      disposition: { forced: 0, hearing_impaired: 1 },
    },
    {
      index: 4,
      codec_type: 'subtitle',
      codec_name: 'hdmv_pgs_subtitle',
      tags: { language: 'und' },
    },
    {
      index: 5,
      codec_type: 'video',
      codec_name: 'mjpeg',
      width: 600,
      height: 900,
      disposition: { attached_pic: 1 },
    },
  ],
}

describe('parseProbe', () => {
  it('reads video, audio and subtitle streams', () => {
    const facts = parseProbe(SAMPLE)
    expect(facts.duration).toBeCloseTo(6720.512)
    expect(facts.container).toBe('matroska,webm')
    expect(facts.bitrate).toBe(45_000_000)
    expect(facts.video).toMatchObject({
      codec: 'hevc',
      width: 3840,
      height: 2160,
      bitDepth: 10,
      frameRate: 23.976,
      hdr: ['dv', 'hdr10'],
    })
    expect(facts.audio).toEqual([
      expect.objectContaining({
        index: 1,
        codec: 'truehd',
        channels: 8,
        language: 'en',
        default: true,
      }),
      expect.objectContaining({
        index: 2,
        codec: 'ac3',
        channels: 6,
        language: 'fr',
        default: false,
      }),
    ])
    expect(facts.subtitles).toEqual([
      { index: 3, codec: 'subrip', language: 'en', forced: false, hi: true },
      { index: 4, codec: 'hdmv_pgs_subtitle', language: null, forced: null, hi: null },
    ])
  })

  it('ignores cover art as the video stream', () => {
    const facts = parseProbe({ streams: [SAMPLE.streams[5]] })
    expect(facts.video).toBeUndefined()
  })

  it('tells HDR10+ and HLG from HDR10', () => {
    const one = (extra: object) =>
      parseProbe({ streams: [{ codec_type: 'video', width: 1, height: 1, ...extra }] }).video!.hdr
    expect(
      one({
        color_transfer: 'smpte2084',
        side_data_list: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }],
      }),
    ).toEqual(['hdr10plus'])
    expect(one({ color_transfer: 'arib-std-b67' })).toEqual(['hlg'])
    expect(one({ color_transfer: 'bt709' })).toEqual([])
  })

  it('rejects output without a stream list', () => {
    expect(() => parseProbe({})).toThrow('stream inventory')
    expect(() => parseProbe(null)).toThrow('stream inventory')
  })
})

describe('normalizeLanguage', () => {
  it('maps three-letter codes and drops unknowns', () => {
    expect(normalizeLanguage('eng')).toBe('en')
    expect(normalizeLanguage('pob')).toBe('pt-BR')
    expect(normalizeLanguage('und')).toBeNull()
    expect(normalizeLanguage(undefined)).toBeNull()
  })
})

describe('probe and fingerprint', () => {
  let dir: string
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'probe-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function fake(script: string) {
    const path = join(dir, 'ffprobe')
    writeFileSync(path, `#!/bin/sh\n${script}\n`)
    chmodSync(path, 0o755)
    return path
  }

  it('runs the binary and parses its JSON', async () => {
    const binary = fake(`cat <<'EOF'\n${JSON.stringify(SAMPLE)}\nEOF`)
    const facts = await probe(join(dir, 'movie.mkv'), binary)
    expect(facts.video?.height).toBe(2160)
  })

  it('reports failures without leaking the command line', async () => {
    const binary = fake('echo secret-path-detail >&2; exit 1')
    const error = await probe(join(dir, 'movie.mkv'), binary).catch((e) => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/media tool failed/)
    expect((error as Error).message).not.toMatch(/secret|movie\.mkv/)
  })

  it('rejects output that is not JSON', async () => {
    const binary = fake('echo not json')
    await expect(probe(join(dir, 'movie.mkv'), binary)).rejects.toThrow('valid output')
  })

  it('reports a missing binary', async () => {
    await expect(probe('x', join(dir, 'nope'))).rejects.toThrow('ENOENT')
  })

  it('fingerprints change with the file and match for hardlinks', async () => {
    const { linkSync } = await import('node:fs')
    const a = join(dir, 'a.mkv')
    writeFileSync(a, 'one')
    const first = await fingerprint(a)
    linkSync(a, join(dir, 'b.mkv'))
    expect(await fingerprint(join(dir, 'b.mkv'))).toBe(first)
    writeFileSync(a, 'one-two')
    expect(await fingerprint(a)).not.toBe(first)
    await expect(fingerprint(dir)).rejects.toThrow('not a file')
  })
})
