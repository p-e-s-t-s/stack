import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import * as tmdb from '../src'

const MOVIE = {
  id: 603,
  title: 'The Matrix',
  original_title: 'Matrix',
  original_language: 'en',
  release_date: '1999-03-30',
  overview: 'Neo.',
  poster_path: '/p.jpg',
  backdrop_path: '/b.jpg',
  runtime: 136,
  genres: [{ name: 'Action' }],
  imdb_id: 'tt0133093',
  release_dates: {
    results: [
      {
        iso_3166_1: 'US',
        release_dates: [
          { type: 3, release_date: '1999-03-31T00:00:00.000Z' },
          { type: 4, release_date: '1999-09-21T00:00:00.000Z' },
          { type: 5, release_date: '1999-12-07T00:00:00.000Z' },
        ],
      },
      { iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: '1999-06-11T00:00:00.000Z' }] },
    ],
  },
  alternative_titles: { titles: [{ title: 'Matrix' }, { title: 'La Matrice' }] },
}

const SERIES = {
  id: 1399,
  name: 'Game of Thrones',
  original_name: 'Game of Thrones',
  first_air_date: '2011-04-17',
  status: 'Ended',
  networks: [{ name: 'HBO' }],
  episode_run_time: [60],
  poster_path: '/s.jpg',
  seasons: [
    { season_number: 0, name: 'Specials', episode_count: 1 },
    { season_number: 1, name: 'Season 1', episode_count: 2, poster_path: '/s1.jpg' },
  ],
  external_ids: { imdb_id: 'tt0944947', tvdb_id: 121361 },
  alternative_titles: { results: [{ title: 'GoT' }] },
  'season/0': { episodes: [{ season_number: 0, episode_number: 1, name: 'Special' }] },
  'season/1': {
    episodes: [
      { season_number: 1, episode_number: 1, name: 'Winter', air_date: '2011-04-17', runtime: 62 },
      { season_number: 1, episode_number: 2, name: '', air_date: null },
    ],
  },
}

let server: Server
let base: string
let requests: { path: string; query: URLSearchParams; auth?: string }[]
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    requests.push({ path: url.pathname, query: url.searchParams, auth: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    const send = (body: unknown) => res.end(JSON.stringify(body))
    if (url.pathname === '/search/movie') return send({ results: [MOVIE] })
    if (url.pathname === '/search/tv') return send({ results: [SERIES] })
    if (url.pathname === '/movie/603') return send(MOVIE)
    if (url.pathname === '/tv/1399') return send(SERIES)
    if (url.pathname === '/trending/movie/week')
      return send({ results: Array.from({ length: 15 }, (_, i) => ({ ...MOVIE, id: i })) })
    if (url.pathname === '/movie/popular')
      return send({ results: Array.from({ length: 25 }, (_, i) => ({ ...MOVIE, id: i })) })
    if (url.pathname === '/find/tt0133093') return send({ movie_results: [MOVIE] })
    if (url.pathname === '/find/tt0') return send({ movie_results: [] })
    res.writeHead(404).end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

async function boot(apiKey = 'key') {
  const ctx = new Context()
  await ctx.plugin(HTTP)
  await ctx.plugin(MetadataService)
  await ctx.plugin(tmdb, { apiKey, language: 'en-US', baseUrl: base })
  return ctx.metadata.get('tmdb')!
}

beforeEach(() => void (requests = []))

it('searches movies and series, passing the year and api key', async () => {
  const p = await boot()
  const movies = await p.search({ kind: 'movie', term: 'matrix', year: 1999 })
  expect(movies[0]).toMatchObject({
    kind: 'movie',
    title: 'The Matrix',
    year: 1999,
    posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
    ids: { tmdb: '603', imdb: 'tt0133093' },
  })
  expect(requests[0]!.query.get('api_key')).toBe('key')
  expect(requests[0]!.query.get('year')).toBe('1999')
  expect(requests[0]!.auth).toBeUndefined()

  const series = await p.search({ kind: 'series', term: 'thrones' })
  expect(series[0]).toMatchObject({
    kind: 'series',
    title: 'Game of Thrones',
    year: 2011,
    ids: { tmdb: '1399', imdb: 'tt0944947', tvdb: '121361' },
  })
  expect(requests[1]!.query.has('first_air_date_year')).toBe(false)
})

it('authenticates with a bearer token when given a long v4 key', async () => {
  const p = await boot('x'.repeat(50))
  await p.search({ kind: 'movie', term: 'matrix' })
  expect(requests[0]!.auth).toBe(`Bearer ${'x'.repeat(50)}`)
  expect(requests[0]!.query.has('api_key')).toBe(false)
})

it('reads a movie with release dates and alternate titles', async () => {
  const movie = await (await boot()).getMovie!('603')
  expect(movie).toMatchObject({
    runtimeMinutes: 136,
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
    genres: ['Action'],
    alternateTitles: ['Matrix', 'La Matrice'],
    releaseDates: { theatrical: '1999-03-31', digital: '1999-09-21', physical: '1999-12-07' },
  })
})

it('reads a series and maps its status and seasons', async () => {
  const series = await (await boot()).getSeries!('1399')
  expect(series).toMatchObject({
    status: 'ended',
    network: 'HBO',
    runtimeMinutes: 60,
    firstAired: '2011-04-17',
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

it('reads every episode of every season, blanking empty fields', async () => {
  const episodes = await (await boot()).getEpisodes!('1399')
  expect(requests.at(-1)!.query.get('append_to_response')).toBe('season/0,season/1')
  expect(episodes.map((e) => [e.season, e.number, e.title, e.airDate, e.runtimeMinutes])).toEqual([
    [0, 1, 'Special', undefined, undefined],
    [1, 1, 'Winter', '2011-04-17', 62],
    [1, 2, undefined, undefined, undefined],
  ])
})

it('caps discovery feeds and rejects unknown ones', async () => {
  const p = await boot()
  expect(await p.discover!('movie-trending', 'US')).toHaveLength(10)
  expect(await p.discover!('movie-popular', 'US')).toHaveLength(20)
  expect(requests.at(-1)!.query.get('region')).toBe('US')
  await expect(p.discover!('nope', 'US')).rejects.toThrow('Unknown discovery feed')
})

it('maps an imdb id to a tmdb id, leaving unknown ids alone', async () => {
  const p = await boot()
  expect(await p.mapIds!({ imdb: 'tt0133093' })).toEqual({ imdb: 'tt0133093', tmdb: '603' })
  expect(await p.mapIds!({ imdb: 'tt0' })).toEqual({ imdb: 'tt0' })
  expect(await p.mapIds!({ tmdb: '1' })).toEqual({ tmdb: '1' })
})
