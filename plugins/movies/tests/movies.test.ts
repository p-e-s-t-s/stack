import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import * as tmdb from '@magpiejs/metadata-tmdb'
import { Context } from 'cordis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import MoviesService, { isAvailable } from '../src'

// a fake TMDB with one movie
let server: Server
let baseUrl: string
let title = 'The Matrix'
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/json')
    if (url.searchParams.get('api_key') !== 'KEY') return res.writeHead(401).end('{}')
    if (url.pathname === '/search/movie') {
      return res.end(
        JSON.stringify({
          results: [{ id: 603, title, release_date: '1999-03-31', poster_path: '/p.jpg' }],
        }),
      )
    }
    if (url.pathname === '/movie/603') {
      return res.end(
        JSON.stringify({
          id: 603,
          title,
          original_title: 'The Matrix',
          release_date: '1999-03-31',
          runtime: 136,
          imdb_id: 'tt0133093',
          release_dates: {
            results: [
              {
                iso_3166_1: 'US',
                release_dates: [
                  { type: 3, release_date: '1999-03-31T00:00:00Z' },
                  { type: 5, release_date: '1999-09-21T00:00:00Z' },
                ],
              },
            ],
          },
          alternative_titles: { titles: [{ title: 'Matrix' }] },
        }),
      )
    }
    res.writeHead(404).end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

let ctx: Context
let root: string
beforeEach(async () => {
  title = 'The Matrix'
  root = mkdtempSync(join(tmpdir(), 'magpie-movies-'))
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(tmdb, { apiKey: 'KEY', baseUrl, language: 'en-US' })
  await ctx.plugin(MoviesService)
  return () => rmSync(root, { recursive: true, force: true })
})

describe('movies', () => {
  it('adds a movie from TMDB with its details, folder and alternate titles', async () => {
    const folder = ctx.library.addRootFolder(join(root, 'movies'), 'movie')
    const profileId = ctx.decision.profiles()[0]!.id
    const [found] = await ctx.movies.lookup('matrix')
    expect(found).toMatchObject({ title: 'The Matrix', year: 1999, libraryId: undefined })

    const added: unknown[] = []
    ctx.on('movies/added', (movie, options) => void added.push([movie.title, options.search]))
    const movie = await ctx.movies.add({ tmdbId: 603, profileId, rootFolderId: folder.id })
    expect(movie).toMatchObject({
      title: 'The Matrix',
      folder: 'The Matrix (1999)',
      externalIds: { tmdb: '603', imdb: 'tt0133093' },
      details: { runtimeMinutes: 136, inCinemas: '1999-03-31', physicalRelease: '1999-09-21' },
    })
    expect(added).toEqual([['The Matrix', true]])
    expect(isAvailable(movie.details)).toBe(true)
    expect(ctx.library.findByTitle('Matrix').map((m) => m.id)).toEqual([movie.id])
    expect((await ctx.movies.lookup('matrix'))[0]!.libraryId).toBe(movie.id)
    await expect(
      ctx.movies.add({ tmdbId: 603, profileId, rootFolderId: folder.id }),
    ).rejects.toThrow(/already/)
  })

  it('refreshes metadata and removes movie data with the library item', async () => {
    const folder = ctx.library.addRootFolder(join(root, 'movies'), 'movie')
    const movie = await ctx.movies.add({ tmdbId: 603, profileId: 1, rootFolderId: folder.id })
    title = 'The Matrix (Remastered)'
    await ctx.movies.refresh(movie.id)
    expect(ctx.movies.get(movie.id)!.title).toBe('The Matrix (Remastered)')

    ctx.movies.remove(movie.id)
    expect(ctx.movies.list()).toEqual([])
    expect(
      ctx.movies.db
        .select()
        .from((await import('../src/schema')).details)
        .all(),
    ).toEqual([])
  })

  it('waits for the minimum availability', () => {
    const base = {
      minimumAvailability: 'released',
      inCinemas: '2026-01-01',
      digitalRelease: null,
      physicalRelease: null,
    } as never
    const now = Date.parse('2026-02-01')
    expect(isAvailable(base, now)).toBe(false)
    expect(
      isAvailable({ ...(base as object), minimumAvailability: 'inCinemas' } as never, now),
    ).toBe(true)
    expect(isAvailable({ ...(base as object), digitalRelease: '2026-01-20' } as never, now)).toBe(
      true,
    )
  })
})
