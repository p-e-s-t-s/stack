import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import * as torznab from '../src'

let server: Server
let base: string
const requests: URLSearchParams[] = []
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (url.searchParams.get('t') === 'caps') {
      return res.end(`<caps><searching><search available="yes" supportedParams="q"/>
        <tv-search available="yes" supportedParams="q,season,ep,tvdbid"/>
        <music-search available="yes" supportedParams="q,artist,album"/></searching>
        <categories><category id="3000" name="Audio"/></categories></caps>`)
    }
    requests.push(url.searchParams)
    res.end('<rss><channel></channel></rss>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('searches each kind with its search type and categories', async () => {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(IndexersService)
  const kind = 'music' as never
  ctx.indexers.searchType(kind, {
    mode: 'music',
    fields: ['artist', 'album'],
    defaultCategories: [3000],
  })
  ctx.indexers.searchType('series', {
    mode: 'tvsearch',
    ids: { tvdb: 'tvdbid' },
    defaultCategories: [5000],
  })
  await ctx.plugin(torznab, {
    name: 'Test',
    url: `${base}/api`,
    categories: { music: [3040] },
    tvCategories: [5030], // the setting before categories per kind
  } as unknown as torznab.Config)
  const [indexer] = ctx.indexers.usable('automatic')
  const provider = indexer![1].provider

  await provider.search({ kind, term: 'x', fields: { artist: 'Portishead', album: 'Dummy' } })
  expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({
    t: 'music',
    artist: 'Portishead',
    album: 'Dummy',
    cat: '3040',
  })
  expect(requests.at(-1)!.has('q')).toBe(false)

  await provider.search({ kind: 'series', term: 'Show', ids: { tvdb: '1' }, season: 2 })
  expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({
    t: 'tvsearch',
    tvdbid: '1',
    season: '2',
    cat: '5030',
  })

  await provider.rss!()
  expect(requests.at(-1)!.get('cat')!.split(',').sort()).toEqual(['3040', '5030'])
})
