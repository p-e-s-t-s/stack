import { describe, expect, it } from 'vitest'
import { downloadPercent } from '@magpiejs/console-kit'
import type { MovieSummary } from '../src/console'
import { movieDownloads } from '../src/download-state'
import { movieStatus } from '../client/status'
const movie = (download?: MovieSummary['download']) =>
  ({ monitored: true, available: true, download }) as MovieSummary
describe('movie download presentation', () => {
  it.each(['grabbed', 'queued', 'downloading', 'paused', 'stalled', 'import_pending', 'importing'])(
    'shows %s rather than Missing without a file',
    (state) => {
      const status = movieStatus(movie({ state, progress: 0.42 }))
      expect(status.text).not.toBe('Missing')
      expect(status.class).toBe('info')
      if (state === 'downloading') expect(status.text).toBe('Downloading 42%')
    },
  )
  it('keeps the latest active download and reads changed snapshots without a cache', () => {
    const first = {
      id: 1,
      mediaId: 7,
      state: 'downloading' as const,
      progress: 0.2,
      grabbedAt: 100,
    }
    const newer = { ...first, id: 2, progress: 0.7, grabbedAt: 200 }
    expect(movieDownloads([newer, first]).get(7)?.progress).toBe(0.7)
    expect(movieDownloads([{ ...first, progress: 0.9 }]).get(7)?.progress).toBe(0.9)
    expect(movieDownloads([]).has(7)).toBe(false)
  })
  it('returns to file availability after downloads finish or fail', () => {
    expect(movieStatus(movie()).text).toBe('Missing')
    const completed = movie()
    completed.file = { path: 'movie.mkv', size: 100, quality: 'Bluray', releaseName: null }
    expect(movieStatus(completed).text).toBe('Downloaded')
    completed.download = { state: 'downloading', progress: 0.5 }
    expect(movieStatus(completed).text).toBe('Downloading 50%')
  })
  it('clamps percentages and tolerates invalid progress', () => {
    expect([-0.1, 0.428, 1, 1.5, NaN, Infinity].map(downloadPercent)).toEqual([
      0, 42, 100, 100, 0, 0,
    ])
  })
})
