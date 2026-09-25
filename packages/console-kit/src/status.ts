import type { Protocol } from '@magpiejs/types'

/** A release from an indexer search, as shown by `ReleasePicker` (and, for movies, inline). */
export interface ReleaseRow {
  guid: string
  title: string
  indexer: string
  protocol: Protocol
  size?: number
  seeders?: number
  leechers?: number
  publishedAt?: string
  infoUrl?: string
  /** The part of the item it covers, e.g. `S01E02`, `Season 1`, a book or album title. */
  unit?: string
  quality: string
  formatScore: number
  matchedFormats: string[]
  accepted: boolean
  rejections: { rule: string; reason: string }[]
}

/** A file size as MB below 1 GB, GB above it. */
export function fileSize(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** Labels for a grab's state, everywhere except `downloading` (which also carries a percent). */
export const DOWNLOAD_LABELS: Record<string, string> = {
  grabbed: 'Sent to client',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Importing soon',
  importing: 'Importing',
}

/** Badge text and class for an active download, e.g. `Downloading 42%`. */
export function downloadStatus(state: string, progress: number) {
  const text =
    state === 'downloading'
      ? `Downloading ${Math.floor(progress * 100)}%`
      : (DOWNLOAD_LABELS[state] ?? state)
  return { text, class: 'info' }
}
