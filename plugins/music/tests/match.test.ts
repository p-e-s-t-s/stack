import { expect, it } from 'vitest'
import { audioQualityOf } from '../src/families'
import { matchAlbum, matchAlbums, matchTrack } from '../src/match'
import { parseMusic } from '../src/parse'

const match = (release: string, artist: string, album: string) =>
  matchAlbum(parseMusic(release), [artist], { title: album })

it('matches releases to albums by artist and title', () => {
  expect(match('Radiohead-In_Rainbows-WEB-2007-GRP', 'Radiohead', 'In Rainbows')).toBe(true)
  expect(match('Radiohead - In Rainbows (Deluxe Edition) [FLAC]', 'Radiohead', 'In Rainbows')).toBe(
    true,
  )
  // artists with dashes, and folded spellings
  expect(match('Hi-Tek-Hi-Teknology-2LP-FLAC-2026-GRP', 'Hi-Tek', 'Hi-Teknology')).toBe(true)
  expect(match('Sigur_Ros-Agaetis_Byrjun-CD-FLAC-1999-GRP', 'Sigur Rós', 'Ágætis byrjun')).toBe(
    true,
  )
  // self-titled albums need the name twice
  expect(match('Weezer-Weezer-CD-FLAC-1994-GRP', 'Weezer', 'Weezer')).toBe(true)
  expect(match('Weezer-Pinkerton-CD-FLAC-1996-GRP', 'Weezer', 'Weezer')).toBe(false)
  // another album whose title starts the same, a live album, another artist
  expect(match('Radiohead - Kid A Mnesia (2021) [FLAC]', 'Radiohead', 'Kid A')).toBe(false)
  expect(match('Moe.-L_(Live)-16BIT-WEB-FLAC-2000-GRP', 'Moe.', 'L')).toBe(false)
  expect(match('Radiohead Tribute - In Rainbows [FLAC]', 'Radiohead', 'In Rainbows')).toBe(false)
  expect(
    matchAlbums(
      parseMusic('Radiohead - Kid A Mnesia [FLAC]'),
      ['Radiohead'],
      [{ title: 'Kid A' }, { title: 'Kid A Mnesia' }],
    ),
  ).toEqual([{ title: 'Kid A Mnesia' }])
})

it('matches files to tracks by number, title and length', () => {
  const tracks = [
    { id: 1, disc: 1, number: 1, title: '15 Step', lengthMs: 238_000 },
    { id: 2, disc: 1, number: 2, title: 'Bodysnatchers', lengthMs: 242_000 },
    { id: 3, disc: 2, number: 1, title: 'MK 1', lengthMs: 60_000 },
  ]
  // no disc on a two-disc album: the number alone can't tell, the title can
  expect(matchTrack({ track: 2, title: 'Bodysnatchers' }, tracks, 2)?.id).toBe(2)
  expect(matchTrack({ track: 1 }, tracks, 2)).toBeUndefined()
  expect(matchTrack({ disc: 1, track: 2, title: 'Bodysnatchers' }, tracks, 2)?.id).toBe(2)
  expect(matchTrack({ disc: 2, track: 1 }, tracks, 2)?.id).toBe(3)
  // numbering off, title right: the title wins; length too far off: no match
  expect(matchTrack({ disc: 1, track: 5, title: '15 Step' }, tracks, 2)?.id).toBe(1)
  expect(
    matchTrack({ disc: 1, track: 1, title: '15 Step', seconds: 400 }, tracks, 2),
  ).toBeUndefined()
  // the number says one track, the title another
  expect(matchTrack({ disc: 1, track: 1, title: 'Bodysnatchers' }, tracks, 2)?.id).toBe(2)
})

it('rates releases by codec, bitrate and bit depth', () => {
  expect(
    [
      'Radiohead - In Rainbows [FLAC 24-96]',
      'Radiohead - In Rainbows [FLAC]',
      'Radiohead - In Rainbows [MP3 320]',
      'Radiohead - In Rainbows [MP3 V0]',
      'Radiohead - In Rainbows [MP3 192]',
      'Radiohead-In_Rainbows-WEB-2007-GRP',
      'Radiohead - In Rainbows',
    ].map((n) => audioQualityOf(parseMusic(n))),
  ).toEqual(['flac-24', 'flac', 'mp3-320', 'mp3-v0', 'mp3-192', 'mp3', 'audio-unknown'])
})

it('reads the length of audio files, and nothing from files that are not audio', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { readTags } = await import('../src/import')
  const dir = mkdtempSync(join(tmpdir(), 'magpie-tags-'))
  // two seconds of 8 kHz, 8-bit mono silence
  const data = Buffer.alloc(16_000, 128)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(8000, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(join(dir, 'song.wav'), Buffer.concat([header, data]))
  writeFileSync(join(dir, 'fake.flac'), 'not audio')
  expect((await readTags(join(dir, 'song.wav'))).seconds).toBeCloseTo(2)
  expect(await readTags(join(dir, 'fake.flac'))).toEqual({})
  rmSync(dir, { recursive: true, force: true })
})
