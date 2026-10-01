import { describe, expect, it } from 'vitest'
import { entriesFromCsv, listIdFrom, parseCsv } from '../src'

const csv = `Position,Const,Created,Modified,Description,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year
1,tt0133093,2020-01-01,2020-01-01,,"The Matrix",https://www.imdb.com/title/tt0133093/,movie,8.7,136,1999
2,tt0903747,2020-01-01,2020-01-01,,"Breaking ""Bad"", the show",https://www.imdb.com/title/tt0903747/,tvSeries,9.5,49,2008
3,tt0000001,2020-01-01,2020-01-01,,Short Thing,https://www.imdb.com/title/tt0000001/,short,5,1,1894
`

describe('imdb list', () => {
  it('reads quoted CSV fields', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\r\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ])
  })

  it('keeps movies and series and skips other title types', () => {
    expect(
      entriesFromCsv(csv.replace('tvSeries', 'TV Series').replace(',movie,', ',Movie,')),
    ).toEqual([
      { kind: 'movie', title: 'The Matrix', year: 1999, ids: { imdb: 'tt0133093' } },
      { kind: 'series', title: 'Breaking "Bad", the show', year: 2008, ids: { imdb: 'tt0903747' } },
    ])
  })

  it('rejects a page that is not an export', () => {
    expect(() => entriesFromCsv('<html><body>Sign in</body></html>')).toThrow(/public/)
  })

  it('finds the list id in an address', () => {
    expect(listIdFrom('https://www.imdb.com/list/ls012345678/?ref_=x')).toBe('ls012345678')
    expect(() => listIdFrom('nope')).toThrow()
  })
})
