// Phase 4.6 exit: a podcast added by search and one added by feed URL download new episodes
// on refresh, and retention keeps only the newest N — through the real downloads,
// direct-download client, import and calendar plugins, against a fake feed server.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import CalendarService from '@magpiejs/calendar'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import * as http from '@magpiejs/downloader-http'
import DownloadsService from '@magpiejs/downloads'
import ImportService from '@magpiejs/import'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import * as itunes from '@magpiejs/metadata-itunes'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import PodcastsService, { parseOpml } from '../src'

// ---- fake iTunes, feeds and audio

const feeds: Record<string, { title: string; episodes: { n: number; date: string }[] }> = {
  science: {
    title: 'Science Hour',
    episodes: [1, 2, 3].map((n) => ({ n, date: `2026-09-0${n}` })),
  },
  cooking: { title: 'Cooking Talk', episodes: [{ n: 1, date: '2026-09-05' }] },
}

const rss = (key: string) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
  <title>${feeds[key]!.title}</title><itunes:author>Host</itunes:author>
  ${feeds[key]!.episodes.map(
    ({ n, date }) => `<item><title>Episode ${n}</title><guid>${key}-${n}</guid>
      <pubDate>${new Date(`${date}T10:00:00Z`).toUTCString()}</pubDate>
      <enclosure url="${base}/audio/${key}-${n}.mp3" type="audio/mpeg" length="100"/></item>`,
  ).join('\n')}
</channel></rss>`

let server: Server
let base: string
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    if (url.pathname === '/search') {
      res.setHeader('content-type', 'text/javascript')
      return res.end(
        JSON.stringify({
          results: [
            {
              collectionId: 1,
              collectionName: 'Science Hour',
              artistName: 'Host',
              feedUrl: `${base}/feed/science`,
            },
          ],
        }),
      )
    }
    if (url.pathname.startsWith('/feed/')) {
      res.setHeader('content-type', 'application/rss+xml')
      return res.end(rss(url.pathname.slice(6)))
    }
    if (url.pathname.startsWith('/audio/')) {
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': '100' })
      return res.end(Buffer.alloc(100))
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('follows podcasts by search and by feed URL, downloads new episodes, keeps the newest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-podcasts-'))
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(itunes, { baseUrl: base, country: 'US' })
  await ctx.plugin(DownloadsService)
  await ctx.plugin(http, { downloadDir: join(dir, 'downloads') } as http.Config)
  await ctx.plugin(ImportService)
  await ctx.plugin(CalendarService)
  await ctx.plugin(PodcastsService)
  const rootFolderId = ctx.library.addRootFolder(join(dir, 'podcasts'), 'podcast').id

  /** Lets downloads finish and imports run. */
  async function settle() {
    for (let i = 0; i < 100; i++) {
      await ctx.downloads.monitor()
      await ctx.jobs.tick()
      const wanted = ctx.podcasts.list().some((p) => ctx.podcasts.wanted(p.id).length)
      if (!wanted && !ctx.downloads.active().length) return
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('downloads did not finish')
  }
  const files = (folder: string) =>
    existsSync(join(dir, 'podcasts', folder))
      ? readdirSync(join(dir, 'podcasts', folder)).sort()
      : []

  // by search: the newest two episodes, keeping at most two
  const [found] = await ctx.podcasts.lookup('science')
  expect(found).toMatchObject({ title: 'Science Hour', feedUrl: `${base}/feed/science` })
  const science = await ctx.podcasts.add({
    feedUrl: found!.feedUrl!,
    itunesId: found!.ids.itunes,
    rootFolderId,
    monitor: 'latest',
    latestCount: 2,
    keepLatest: 2,
  })
  await settle()
  expect(files('Science Hour')).toEqual([
    '2026-09-02 - Episode 2.mp3',
    '2026-09-03 - Episode 3.mp3',
  ])

  // by feed URL: only new episodes
  const cooking = await ctx.podcasts.add({ feedUrl: `${base}/feed/cooking`, rootFolderId })
  await settle()
  expect(files('Cooking Talk')).toEqual([])

  // new episodes appear in both feeds
  feeds.science!.episodes.push({ n: 4, date: '2026-09-10' })
  feeds.cooking!.episodes.push({ n: 2, date: '2026-09-11' })
  for (const p of [science, cooking]) await ctx.podcasts.refresh(p.id)
  await settle()
  expect(files('Cooking Talk')).toEqual(['2026-09-11 - Episode 2.mp3'])
  // retention: only the newest two stay, and the oldest isn't downloaded again
  expect(files('Science Hour')).toEqual([
    '2026-09-03 - Episode 3.mp3',
    '2026-09-10 - Episode 4.mp3',
  ])
  expect(ctx.podcasts.wanted(science.id)).toEqual([])
  expect(ctx.podcasts.get(science.id)!.stats).toMatchObject({ episodes: 4, downloaded: 2 })

  // on the calendar by publication date
  const entries = ctx.calendar.entries('2026-09-01', '2026-09-30')
  expect(
    entries.filter((e) => e.kind === 'podcast').map((e) => [e.date, e.title, e.state]),
  ).toEqual([
    ['2026-09-01', 'Science Hour', 'unmonitored'],
    ['2026-09-02', 'Science Hour', 'unmonitored'],
    ['2026-09-03', 'Science Hour', 'downloaded'],
    ['2026-09-05', 'Cooking Talk', 'unmonitored'],
    ['2026-09-10', 'Science Hour', 'downloaded'],
    ['2026-09-11', 'Cooking Talk', 'downloaded'],
  ])

  // OPML out and back in: both are already followed
  const opml = (await import('../src')).toOpml(
    ctx.podcasts.list().map((p) => ({ title: p.title, feedUrl: p.details.feedUrl })),
  )
  expect(parseOpml(opml).map((o) => o.title)).toEqual(['Cooking Talk', 'Science Hour'])
  expect(await ctx.podcasts.importOpml(opml, { rootFolderId })).toEqual({
    added: [],
    skipped: ['Cooking Talk', 'Science Hour'],
    failed: [],
  })

  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})
