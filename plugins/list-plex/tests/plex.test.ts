import { describe, expect, it } from 'vitest'
import { entryOf } from '../src'

describe('plex watchlist', () => {
  it('reads ids from guids', () => {
    expect(
      entryOf({
        type: 'show',
        title: 'Severance',
        year: 2022,
        Guid: [{ id: 'imdb://tt11280740' }, { id: 'tmdb://95396' }, { id: 'tvdb://371980' }],
      }),
    ).toEqual({
      kind: 'series',
      title: 'Severance',
      year: 2022,
      ids: { imdb: 'tt11280740', tmdb: '95396', tvdb: '371980' },
    })
    expect(entryOf({ type: 'artist', title: 'Band' })).toBeUndefined()
  })
})
