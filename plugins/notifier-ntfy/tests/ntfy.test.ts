import { describe, expect, it } from 'vitest'
import { payload } from '../src'

describe('ntfy payload', () => {
  it('publishes as JSON so any characters survive', () => {
    expect(
      payload(
        { type: 'media.imported', title: 'Amélie 🎬', body: 'x' },
        { topic: 't', priority: 3 },
      ),
    ).toEqual({ topic: 't', title: 'Amélie 🎬', message: 'x', priority: 3, tags: ['inbox_tray'] })
  })

  it('raises the priority of failures', () => {
    expect(
      payload({ type: 'import.failed', title: 'T' }, { topic: 't', priority: 3 }).priority,
    ).toBe(4)
    expect(
      payload({ type: 'import.failed', title: 'T' }, { topic: 't', priority: 5 }).priority,
    ).toBe(5)
  })
})
