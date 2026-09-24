import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import * as torznab from '@magpiejs/indexer-torznab'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import MoviesService from '../src'

const GB = 1024 ** 3
const item = (title: string, attrs: Record<string, string | number>) => `
  <item>
    <title>${title}</title><guid>${title}</guid><link>http://x/${encodeURIComponent(title)}.torrent</link>
    <pubDate>Tue, 01 Sep 2026 10:00:00 +0000</pubDate>
    ${Object.entries(attrs)
      .map(([k, v]) => `<torznab:attr name="${k}" value="${v}"/>`)
      .join('')}
  </item>`

let server: Server
let base: string
const queries: URLSearchParams[] = []
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (url.pathname === '/broken/api') return res.writeHead(500).end('boom')
    if (url.searchParams.get('apikey') !== 'KEY')
      return res.end('<error code="100" description="Incorrect user credentials"/>')
    if (url.searchParams.get('t') === 'caps') {
      return res.end(`<caps><searching><search available="yes" supportedParams="q"/>
        <movie-search available="yes" supportedParams="q,imdbid,tmdbid"/></searching>
        <categories><category id="2000" name="Movies"><subcat id="2040" name="Movies/HD"/></category></categories></caps>`)
    }
    queries.push(url.searchParams)
    res.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
      ${item('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', { size: 8 * GB, seeders: 40, peers: 45, imdbid: '0063350' })}
      ${item('Night.of.the.Living.Dead.1968.720p.BluRay.x264-OLD', { size: 4 * GB, seeders: 90, peers: 95 })}
      ${item('Night.of.the.Living.Dead.1990.1080p.BluRay.x264-GRP', { size: 8 * GB, seeders: 10, peers: 11, imdbid: '0100258' })}
      ${item('Night.of.the.Living.Dead.1968.CAM.x264-BAD', { size: 1 * GB, seeders: 5, peers: 6 })}
    </channel></rss>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

let ctx: Context
let root: string
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'magpie-search-'))
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(IndexersService)
  await ctx.plugin(MoviesService)
  await ctx.plugin(torznab, { name: 'Test', url: `${base}/1/api`, apiKey: 'KEY' } as torznab.Config)
  return () => rmSync(root, { recursive: true, force: true })
})

async function addMovie() {
  // insert directly (the TMDB side is tested elsewhere)
  const folder = ctx.library.addRootFolder(join(root, 'movies'), 'movie')
  const hd = ctx.decision.profiles().find((p) => p.name === 'HD')!.id
  const item = ctx.library.add(
    {
      kind: 'movie',
      title: 'Night of the Living Dead',
      year: 1968,
      externalIds: { tmdb: '10331', imdb: 'tt0063350' },
      primaryProvider: 'tmdb',
      profileId: hd,
      rootFolderId: folder.id,
      folder: 'Night of the Living Dead (1968)',
    },
    ['Night of the Flesh Eaters'],
  )
  ctx.movies.db
    .insert((await import('../src/schema')).details)
    .values({ mediaId: item.id, tmdbId: 10331, imdbId: 'tt0063350', runtimeMinutes: 96 })
    .run()
  return item.id
}

describe('movie search through Torznab', () => {
  it('searches by id, matches the movie and ranks with reasons', async () => {
    const id = await addMovie()
    const { results, errors } = await ctx.movies.search(id, 'interactive')
    expect(errors).toEqual([])
    expect(queries.at(-1)!.get('t')).toBe('movie')
    expect(queries.at(-1)!.get('imdbid')).toBe('0063350')
    expect(queries.at(-1)!.get('tmdbid')).toBe('10331')

    const summary = results.map((r) => [
      r.release.title,
      r.decision.accepted,
      r.decision.rejections.map((x) => x.rule),
    ])
    expect(summary).toEqual([
      ['Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', true, []],
      ['Night.of.the.Living.Dead.1968.720p.BluRay.x264-OLD', true, []],
      ['Night.of.the.Living.Dead.1990.1080p.BluRay.x264-GRP', false, ['movie-match']],
      ['Night.of.the.Living.Dead.1968.CAM.x264-BAD', false, ['quality-allowed']],
    ])
    expect(results[0]!.release).toMatchObject({
      seeders: 40,
      leechers: 5,
      size: 8 * GB,
      indexerName: 'Test',
    })
    expect(ctx.movies.searcher!.cached(id, results[0]!.release.guid)).toBeTruthy()
  })

  it('reports failing indexers and backs off from them', async () => {
    const id = await addMovie()
    await ctx.plugin(torznab, {
      name: 'Broken',
      url: `${base}/broken/api`,
      apiKey: 'KEY',
    } as torznab.Config)
    const { results, errors } = await ctx.movies.search(id)
    expect(results.length).toBe(4)
    expect(errors.map((e) => e.indexer)).toEqual(['Broken'])
    const broken = ctx.indexers.health().find((i) => i.name === 'Broken')!
    expect(broken).toMatchObject({ healthy: false, failures: 1 })
    // automatic searches skip it while it backs off
    expect(ctx.indexers.usable('automatic').map(([, i]) => i.name)).toEqual(['Test'])
  })

  it('surfaces indexer errors such as a wrong API key', async () => {
    await ctx.plugin(torznab, {
      name: 'Wrong key',
      url: `${base}/2/api`,
      apiKey: 'nope',
    } as torznab.Config)
    const id = ctx.indexers.health().find((i) => i.name === 'Wrong key')!.id
    expect(await ctx.indexers.test(id)).toMatchObject({
      ok: false,
      message: 'Incorrect user credentials (code 100)',
    })
  })
})
