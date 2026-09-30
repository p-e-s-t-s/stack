import type { MediaItem } from '@magpiejs/library'
import type { Context } from 'cordis'

/** Files an import put into the library or took out of it, for notifications and refreshes. */
export interface MediaChange {
  /** `download` for automatic imports, `manual` for the manual-import review. */
  origin: 'download' | 'manual'
  item: MediaItem
  /** Files now in the library (absolute paths). */
  added: string[]
  /** Files a replacement took out (absolute paths). */
  removed: string[]
  /** A replacement rather than a first import. */
  replaced: boolean
  /** The release name, when there is one. */
  release?: string
}

declare module 'cordis' {
  interface Events {
    'media/changed'(change: MediaChange): void
  }
}

/**
 * Announces a committed change. Listeners are best effort: one that throws is logged and
 * can never turn a finished import into a failed one.
 */
export function announceChange(ctx: Context, change: MediaChange) {
  if (!change.added.length && !change.removed.length) return
  try {
    ctx.emit('media/changed', change)
  } catch (error) {
    ctx.logger.warn('a media/changed listener failed: %s', (error as Error).message)
  }
}
