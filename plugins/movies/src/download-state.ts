import type { Grab } from '@magpiejs/downloads'

/** Prefer the newest active grab; terminal events cannot hide another active download. */
export function movieDownloads(
  active: Pick<Grab, 'id' | 'mediaId' | 'state' | 'progress' | 'grabbedAt'>[],
) {
  const downloads = new Map<number, { state: string; progress: number }>()
  for (const grab of [...active].sort((a, b) => a.grabbedAt - b.grabbedAt || a.id - b.id)) {
    downloads.set(grab.mediaId, { state: grab.state, progress: grab.progress })
  }
  return downloads
}
