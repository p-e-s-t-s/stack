// Quality families for books: ebooks by file format, audiobooks by audio format. Both parse
// release names with `parseBook`.

import {
  type FamilyCondition,
  profileItems,
  type QualityFamily,
  safeRegex,
} from '@magpiejs/decision'
import { AUDIO_RANK, EBOOK_RANK, type ParsedBook, parseBook } from './parse'

const EBOOK_QUALITIES = [
  { id: 'ebook-unknown', name: 'Unknown ebook' },
  { id: 'ebook-pdf', name: 'PDF' },
  { id: 'ebook-cbr', name: 'CBR' },
  { id: 'ebook-cbz', name: 'CBZ' },
  { id: 'ebook-mobi', name: 'MOBI' },
  { id: 'ebook-azw3', name: 'AZW3' },
  { id: 'ebook-epub', name: 'EPUB' },
]

const AUDIOBOOK_QUALITIES = [
  { id: 'audiobook-unknown', name: 'Unknown audiobook' },
  { id: 'audiobook-mp3', name: 'MP3' },
  { id: 'audiobook-flac', name: 'FLAC' },
  { id: 'audiobook-m4b', name: 'M4B' },
]

const yesNo = (flag: boolean | undefined, value: string) =>
  value === 'no' ? flag === false : flag === true

const retail: FamilyCondition<ParsedBook> = {
  label: 'Retail',
  values: ['yes', 'no'],
  test: (p, v) => yesNo(p.retail, v),
}

export const ebookFamily: QualityFamily<ParsedBook> = {
  id: 'ebook',
  label: 'Ebooks',
  qualities: EBOOK_QUALITIES,
  parse: parseBook,
  // a multi-format release is as good as its best format
  qualityOf: (p) => {
    const best = EBOOK_RANK.find((f) => p.formats.includes(f))
    return best ? `ebook-${best}` : 'ebook-unknown'
  },
  sizeRule: 'total',
  defaultProfiles: [
    {
      name: 'Ebook',
      items: profileItems(
        EBOOK_QUALITIES.map((q) => q.id),
        ['ebook-mobi', 'ebook-azw3', 'ebook-epub'],
      ),
      cutoff: 'ebook-epub',
    },
    {
      name: 'Any ebook',
      items: profileItems(
        EBOOK_QUALITIES.map((q) => q.id),
        EBOOK_QUALITIES.map((q) => q.id).filter((q) => q !== 'ebook-unknown'),
      ),
      cutoff: 'ebook-epub',
    },
  ],
  conditions: {
    retail,
    format: {
      label: 'Format',
      values: ['epub', 'azw3', 'mobi', 'pdf', 'cbz', 'cbr'],
      test: (p, v) => p.formats.includes(v as never),
    },
  },
  rules: {
    'book-kind': ({ parsed }) => {
      if ((parsed as ParsedBook).kind === 'audiobook')
        return { reason: 'is an audiobook', permanent: true }
    },
  },
}

export const audiobookFamily: QualityFamily<ParsedBook> = {
  id: 'audiobook',
  label: 'Audiobooks',
  qualities: AUDIOBOOK_QUALITIES,
  parse: parseBook,
  qualityOf: (p) => {
    const best = AUDIO_RANK.find((f) => p.formats.includes(f))
    return best ? `audiobook-${best}` : 'audiobook-unknown'
  },
  sizeRule: 'total',
  defaultProfiles: [
    {
      name: 'Audiobook',
      items: profileItems(
        AUDIOBOOK_QUALITIES.map((q) => q.id),
        ['audiobook-mp3', 'audiobook-flac', 'audiobook-m4b'],
      ),
      cutoff: 'audiobook-m4b',
    },
  ],
  conditions: {
    retail,
    unabridged: {
      label: 'Unabridged',
      values: ['yes', 'no'],
      test: (p, v) => yesNo(p.unabridged, v),
    },
    narrator: {
      label: 'Narrator (regex)',
      test: (p, v) => !!p.narrator && safeRegex(v).test(p.narrator),
    },
    format: {
      label: 'Format',
      values: ['m4b', 'mp3', 'flac'],
      test: (p, v) => p.formats.includes(v as never),
    },
  },
  rules: {
    'book-kind': ({ parsed }) => {
      if ((parsed as ParsedBook).kind === 'ebook') return { reason: 'is an ebook', permanent: true }
    },
    abridged: ({ parsed, formatScore }) => {
      // allowed only when a custom format explicitly rewards it
      if ((parsed as ParsedBook).unabridged === false && formatScore <= 0)
        return { reason: 'is abridged', permanent: true }
    },
  },
}
