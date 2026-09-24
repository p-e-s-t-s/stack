// The `audio` quality family: lossy formats by bitrate, lossless by format and bit depth. Sizes
// are per minute of album length.

import {
  type FamilyCondition,
  profileItems,
  type QualityFamily,
  safeRegex,
} from '@magpiejs/decision'
import { type ParsedMusic, parseMusic } from './parse'

/** Worst to best. */
export const AUDIO_QUALITIES = [
  { id: 'audio-unknown', name: 'Unknown audio' },
  { id: 'mp3-128', name: 'MP3-128' },
  { id: 'mp3-192', name: 'MP3-192' },
  { id: 'mp3-v2', name: 'MP3-VBR-V2' },
  { id: 'mp3-256', name: 'MP3-256' },
  { id: 'mp3', name: 'MP3' },
  { id: 'mp3-v0', name: 'MP3-VBR-V0' },
  { id: 'mp3-320', name: 'MP3-320' },
  { id: 'vorbis', name: 'Vorbis' },
  { id: 'opus', name: 'Opus' },
  { id: 'aac', name: 'AAC' },
  { id: 'wav', name: 'WAV' },
  { id: 'alac', name: 'ALAC' },
  { id: 'flac', name: 'FLAC' },
  { id: 'flac-24', name: 'FLAC 24-bit' },
]
const ALL = AUDIO_QUALITIES.map((q) => q.id)
const LOSSLESS = ['wav', 'alac', 'flac', 'flac-24']

export function audioQualityOf(p: Pick<ParsedMusic, 'codec' | 'bitDepth' | 'bitrate' | 'vbr'>) {
  switch (p.codec) {
    case 'flac':
      return p.bitDepth === 24 ? 'flac-24' : 'flac'
    case 'alac':
    case 'wav':
    case 'aac':
    case 'opus':
    case 'vorbis':
      return p.codec
    case 'mp3':
      if (p.vbr) return `mp3-${p.vbr}`
      if (!p.bitrate) return 'mp3'
      if (p.bitrate >= 320) return 'mp3-320'
      if (p.bitrate >= 256) return 'mp3-256'
      if (p.bitrate >= 192) return 'mp3-192'
      return 'mp3-128'
    default:
      return 'audio-unknown'
  }
}

const is = (a: unknown, b: string) => String(a) === b

export const audioFamily: QualityFamily<ParsedMusic> = {
  id: 'audio',
  label: 'Audio',
  qualities: AUDIO_QUALITIES,
  parse: parseMusic,
  qualityOf: audioQualityOf,
  sizeRule: 'perMinute',
  // MB per minute of album length
  defaultSizes: {
    'mp3-128': 0.5,
    'mp3-192': 0.8,
    'mp3-v2': 0.8,
    'mp3-256': 1,
    mp3: 0.5,
    'mp3-v0': 1,
    'mp3-320': 1.5,
    wav: 5,
    alac: 3,
    flac: 3,
    'flac-24': 5,
  },
  defaultProfiles: [
    {
      name: 'Any audio',
      items: profileItems(
        ALL,
        ALL.filter((q) => q !== 'audio-unknown'),
      ),
      cutoff: 'flac',
    },
    { name: 'Lossless', items: profileItems(ALL, LOSSLESS), cutoff: 'flac' },
    {
      name: 'Standard',
      items: profileItems(ALL, ['mp3-v0', 'mp3-320', 'mp3', 'aac', 'opus', ...LOSSLESS]),
      cutoff: 'mp3-320',
    },
  ],
  conditions: {
    codec: {
      label: 'Codec',
      values: ['flac', 'alac', 'wav', 'mp3', 'aac', 'opus', 'vorbis'],
      test: (p, v) => is(p.codec, v),
    },
    bitDepth: { label: 'Bit depth', values: ['16', '24'], test: (p, v) => is(p.bitDepth, v) },
    source: {
      label: 'Source',
      values: ['web', 'cd', 'vinyl', 'tape', 'radio'],
      test: (p, v) => is(p.source, v),
    },
    edition: {
      label: 'Edition flag',
      values: ['remastered', 'deluxe', 'promo', 'bootleg'],
      test: (p, v) => p.flags.includes(v),
    },
    name: {
      label: 'Name (regex)',
      test: (p, v) => safeRegex(v).test(p.name),
    } satisfies FamilyCondition<ParsedMusic>,
  },
  rules: {
    // vinyl rips and radio recordings aren't the album unless a custom format says so
    'music-source': ({ parsed, formatScore }) => {
      const source = (parsed as ParsedMusic).source
      if ((source === 'radio' || source === 'tape') && formatScore <= 0)
        return {
          reason: `is a ${source === 'radio' ? 'radio' : 'tape'} recording`,
          permanent: true,
        }
    },
  },
}
