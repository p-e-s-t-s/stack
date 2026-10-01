import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as tmdb from '../src'

const MOVIE = {
  id: 603,
  title: 'The Matrix',
  original_title: 'The Matrix',
  original_language: 'en',
  release_date: '1999-03-31',
  overview: 'A hacker learns the truth.',
  poster_path: '/p.jpg',
  backdrop_path: '/b.jpg',
  runtime: 136,
  imdb_id: 'tt0133093',
  genres: [{ name: 'Action' }, { name: 'Sci-Fi' }],
  release_dates: {
    results: [
      {
        iso_3166_1: 'US',
        release_dates: [
          { type: 3, release_date: '1999-03-31T00:00:00.000Z' },
          { type: 4, release_date: '2000-09-21T00:00:00.000Z' },
        ],
      },
      {
        iso_3166_1: 'GB',
        release_dates: [
          { type: 2, release_date: '1999-06-11T00:00:00.000Z' },
          { type: 5, release_date: '2000-01-01T00:00:00.000Z' },
          { type: 1, release_date: '1998-01-01T00:00:00.000Z' }, // premiere: ignored
        ],
      },
    ],
  },
  alternative_titles: { titles: [{ title: 'Matrix' }, { title: 'The Matrix' }, { title: '' }] },
}

const SERIES = {
  id: 1399,
  name: 'Game of Thrones',
  original_name: 'Game of Thrones',
  original_language: 'en',
  first_air_date: '2011-04-17',
  overview: 'Noble families.',
  poster_path: '/s.jpg',
  backdrop_path: null,
  status: 'Ended',
  networks: [{ name: 'HBO' }],
  genres: [{ name: 'Drama' }],
  episode_run_time: [60],
  seasons: [
    { season_number: 0, name: 'Specials', episode_count: 1, poster_path: null },
    { season_number: 1, name: 'Season 1', episode_count: 2, poster_path: '/s1.jpg' },
  ],
  external_ids: { imdb_id: 'tt0944947', tvdb_id: 121361 },
  alternative_titles: { results: [{ title: 'GoT' }] },
}

let server: Server
let base: string
let requests: { path: string; params: URLSearchParams; headers: IncomingMessage['headers'] }[]

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    requests.push({ path: url.pathname, params: url.searchParams, headers: req.headers })
    res.setHeader('content-type', 'application/json')
    const send = (body: unknown) => res.end(JSON.stringify(body))
    switch (url.pathname) {
      case '/search/movie':
        return send({ results: [MOVIE] })
      case '/search/tv':
        return send({ results: [SERIES] })
      case '/movie/603':
        return send(MOVIE)
      case '/tv/1399': {
        const append = url.searchParams.get('append_to_response')
        if (append?.includes('season/'))
          return send({
            'season/0': {
              episodes: [{ season_number: 0, episode_number: 1, name: 'Recap', air_date: null }],
            },
            'season/1': {
              episodes: [
                {
                  season_number: 1,
                  episode_number: 1,
                  name: 'Winter Is Coming',
                  overview: 'Pilot.',
                  air_date: '2011-04-17',
                  runtime: 62,
                },
                { season_number: 1, episode_number: 2, name: '', runtime: 0 },
              ],
            },
          })
        return send(SERIES)
      }
      case '/find/tt0133093':
        return send({ movie_results: [MOVIE] })
      case '/find/tt404':
        return send({ movie_results: [] })
      case '/trending/movie/week':
      case '/movie/popular':
      case '/discover/movie':
        return send({ results: Array.from({ length: 30 }, (_, i) => ({ ...MOVIE, id: i + 1 })) })
      case '/trending/tv/week':
        return send({ results: [SERIES] })
    }
    res.writeHead(404).end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())
beforeEach(() => {
  requests = []
})

async function provider(config: Partial<tmdb.Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(HTTP)
  await ctx.plugin(MetadataService)
  await ctx.plugin(tmdb, { apiKey: 'key', language: 'en-US', baseUrl: base, ...config })
  return ctx.metadata.get('tmdb')!
}

describe('tmdb search', () => {
  it('maps movie results, including poster and imdb ids', async () => {
    const results = await (await provider()).search({ kind: 'movie', term: 'matrix', year: 1999 })
    expect(results).toEqual([
      {
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        overview: 'A hacker learns the truth.',
        posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
        ids: { tmdb: '603', imdb: 'tt0133093' },
      },
    ])
    expect(requests[0]?.path).toBe('/search/movie')
    expect(Object.fromEntries(requests[0]!.params)).toMatchObject({
      query: 'matrix',
      year: '1999',
      language: 'en-US',
    })
  })

  it('maps series results, including imdb and tvdb ids', async () => {
    const [series] = await (await provider()).search({ kind: 'series', term: 'thrones' })
    expect(series).toMatchObject({
      kind: 'series',
      title: 'Game of Thrones',
      year: 2011,
      ids: { tmdb: '1399', imdb: 'tt0944947', tvdb: '121361' },
    })
    expect(requests[0]?.params.has('first_air_date_year')).toBe(false)
  })
})

describe('tmdb authentication', () => {
  it('sends a short key as the api_key parameter', async () => {
    await (await provider({ apiKey: 'short' })).search({ kind: 'movie', term: 'x' })
    expect(requests[0]?.params.get('api_key')).toBe('short')
    expect(requests[0]?.headers.authorization).toBeUndefined()
  })

  it('sends a long (v4) token as a bearer header and not in the URL', async () => {
    const token = 'a'.repeat(60)
    await (await provider({ apiKey: token })).search({ kind: 'movie', term: 'x' })
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${token}`)
    expect(requests[0]?.params.has('api_key')).toBe(false)
  })
})

describe('tmdb details', () => {
  it('builds movie metadata with the earliest release date per type', async () => {
    const movie = await (await provider()).getMovie!('603')
    expect(movie).toMatchObject({
      runtimeMinutes: 136,
      originalLanguage: 'en',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      genres: ['Action', 'Sci-Fi'],
      // theatrical covers limited (2) and theatrical (3); the premiere (1) is ignored
      releaseDates: { theatrical: '1999-03-31', digital: '2000-09-21', physical: '2000-01-01' },
    })
    // the title itself and blanks are dropped
    expect(movie.alternateTitles).toEqual(['Matrix'])
  })

  it('builds series metadata, mapping status, network and seasons', async () => {
    const series = await (await provider()).getSeries!('1399')
    expect(series).toMatchObject({
      status: 'ended',
      network: 'HBO',
      runtimeMinutes: 60,
      firstAired: '2011-04-17',
      backdropUrl: undefined,
      alternateTitles: ['GoT'],
    })
    expect(series.seasons).toEqual([
      { number: 0, title: 'Specials', episodeCount: 1, posterUrl: undefined },
      {
        number: 1,
        title: 'Season 1',
        episodeCount: 2,
        posterUrl: 'https://image.tmdb.org/t/p/w342/s1.jpg',
      },
    ])
  })

  it('fetches every season in one appended request and normalises blanks', async () => {
    const episodes = await (await provider()).getEpisodes!('1399')
    expect(requests.map((r) => r.params.get('append_to_response'))).toEqual([
      null,
      'season/0,season/1',
    ])
    expect(episodes).toEqual([
      {
        season: 0,
        number: 1,
        title: 'Recap',
        overview: undefined,
        airDate: undefined,
        runtimeMinutes: undefined,
      },
      {
        season: 1,
        number: 1,
        title: 'Winter Is Coming',
        overview: 'Pilot.',
        airDate: '2011-04-17',
        runtimeMinutes: 62,
      },
      {
        season: 1,
        number: 2,
        title: undefined,
        overview: undefined,
        airDate: undefined,
        runtimeMinutes: undefined,
      },
    ])
  })
})

describe('tmdb id mapping', () => {
  it('adds a tmdb id to an imdb-only id set', async () => {
    const p = await provider()
    expect(await p.mapIds!({ imdb: 'tt0133093' })).toEqual({ imdb: 'tt0133093', tmdb: '603' })
  })

  it('leaves ids alone when tmdb is known, imdb is missing, or nothing matches', async () => {
    const p = await provider()
    expect(await p.mapIds!({ tmdb: '1', imdb: 'tt0133093' })).toEqual({
      tmdb: '1',
      imdb: 'tt0133093',
    })
    expect(await p.mapIds!({})).toEqual({})
    expect(await p.mapIds!({ imdb: 'tt404' })).toEqual({ imdb: 'tt404' })
    expect(requests.map((r) => r.path)).toEqual(['/find/tt404'])
  })
})

describe('tmdb discovery', () => {
  it('caps trending at 10 and other feeds at 20', async () => {
    const p = await provider()
    expect(await p.discover!('movie-trending', 'US')).toHaveLength(10)
    expect(await p.discover!('movie-popular', 'US')).toHaveLength(20)
  })

  it('maps series feeds to series results', async () => {
    const [first] = await (await provider()).discover!('series-trending', 'US')
    expect(first?.kind).toBe('series')
  })

  it('asks for the last 30 days of digital releases', async () => {
    const p = await provider()
    await p.discover!('movie-digital', 'GB')
    const params = requests[0]!.params
    expect(requests[0]?.path).toBe('/discover/movie')
    expect(params.get('with_release_type')).toBe('4')
    expect(params.get('region')).toBe('GB')
    const gte = Date.parse(params.get('release_date.gte')!)
    const lte = Date.parse(params.get('release_date.lte')!)
    expect((lte - gte) / 86_400_000).toBe(30)
  })

  it('rejects an unknown feed without calling the API', async () => {
    await expect((await provider()).discover!('nope', 'US')).rejects.toThrow(
      'Unknown discovery feed',
    )
    expect(requests).toHaveLength(0)
  })
})
