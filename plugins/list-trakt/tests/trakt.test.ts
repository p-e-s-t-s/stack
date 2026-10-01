import { describe, expect, it } from 'vitest'
import { entryOf, pathOf } from '../src'

describe('trakt list', () => {
  it('picks the API path', () => {
    expect(pathOf('watchlist')).toBe('/sync/watchlist')
    expect(pathOf('someone/best-of')).toBe('/users/someone/lists/best-of/items')
    expect(pathOf('https://trakt.tv/users/someone/lists/best-of')).toBe(
      '/users/someone/lists/best-of/items',
    )
    expect(() => pathOf('nonsense')).toThrow()
  })

  it('turns items into entries with every id Trakt has', () => {
    expect(
      entryOf({
        type: 'show',
        show: {
          title: 'Severance',
          year: 2022,
          ids: { tmdb: 95396, tvdb: 371980, imdb: 'tt11280740' },
        },
      }),
    ).toEqual({
      kind: 'series',
      title: 'Severance',
      year: 2022,
      ids: { tmdb: '95396', imdb: 'tt11280740', tvdb: '371980' },
    })
    expect(entryOf({ type: 'season' })).toBeUndefined()
  })
})
