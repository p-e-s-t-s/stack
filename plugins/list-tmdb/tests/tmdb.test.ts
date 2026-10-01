import { describe, expect, it } from 'vitest'
import { entryOf, listIdFrom } from '../src'

describe('tmdb list', () => {
  it('takes a list id or address', () => {
    expect(listIdFrom('8301')).toBe('8301')
    expect(listIdFrom('https://www.themoviedb.org/list/8301-my-list')).toBe('8301')
    expect(() => listIdFrom('my-list')).toThrow()
  })

  it('turns items into entries', () => {
    expect(
      entryOf({ id: 603, media_type: 'movie', title: 'The Matrix', release_date: '1999-03-31' }),
    ).toEqual({
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      ids: { tmdb: '603' },
    })
    expect(
      entryOf({ id: 1396, media_type: 'tv', name: 'Breaking Bad', first_air_date: '2008-01-20' }),
    ).toMatchObject({
      kind: 'series',
      year: 2008,
    })
    expect(entryOf({ id: 1, media_type: 'person', name: 'Someone' })).toBeUndefined()
  })
})
