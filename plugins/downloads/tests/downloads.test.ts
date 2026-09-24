import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import * as qbittorrent from '@magpiejs/downloader-qbittorrent'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import type { ReleaseInfo } from '@magpiejs/types'
import { Context } from 'cordis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import DownloadsService, { infoHashOf, magnetHash } from '../src'

// a minimal single-file torrent
const info =
  'd6:lengthi1024e4:name9:movie.mkv12:piece lengthi16384e6:pieces20:' + 'x'.repeat(20) + 'e'
const torrent = Buffer.from(`d8:announce14:http://tracker4:info${info}e`, 'latin1')
const HASH = createHash('sha1').update(Buffer.from(info, 'latin1')).digest('hex')
const MAGNET_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056'

// fake indexer downloads + fake qBittorrent
let server: Server
let base: string
const added: { category?: string; hasFile: boolean; urls?: string }[] = []
let torrents: Record<string, unknown>[] = []
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x')
    if (url.pathname === '/dl/file.torrent') return res.end(torrent)
    if (url.pathname === '/dl/magnet')
      return res.writeHead(302, { location: `magnet:?xt=urn:btih:${MAGNET_HASH}&dn=x` }).end()
    if (url.pathname === '/api/v2/auth/login')
      return res.writeHead(200, { 'set-cookie': 'SID=abc; path=/' }).end('Ok.')
    if (req.headers.cookie !== 'SID=abc') return res.writeHead(403).end('Forbidden')
    if (url.pathname === '/api/v2/torrents/add') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = Buffer.concat(chunks).toString('latin1')
      added.push({
        category: /name="category"\r\n\r\n([^\r]*)/.exec(body)?.[1],
        hasFile: body.includes('name="torrents"'),
        urls: /name="urls"\r\n\r\n([^\r]*)/.exec(body)?.[1],
      })
      return res.end('Ok.')
    }
    if (url.pathname === '/api/v2/torrents/info') return res.end(JSON.stringify(torrents))
    if (url.pathname === '/api/v2/torrents/delete') return res.end('')
    if (url.pathname === '/api/v2/app/version') return res.end('v5.1.0')
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

let ctx: Context
let mediaId: number
beforeEach(async () => {
  added.length = 0
  torrents = []
  ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(qbittorrent, {
    name: 'qBit',
    url: base,
    username: 'admin',
    password: 'x',
    category: 'magpie',
    priority: 1,
  })
  const folder = ctx.library.addRootFolder('/tmp/magpie-dl-test', 'movie')
  mediaId = ctx.library.add({
    kind: 'movie',
    title: 'Night of the Living Dead',
    year: 1968,
    externalIds: {},
    primaryProvider: 'tmdb',
    profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    rootFolderId: folder.id,
    folder: 'x',
  }).id
})

const release = (title: string, downloadUrl: string): ReleaseInfo => ({
  guid: title,
  title,
  protocol: 'torrent',
  indexerId: 'test',
  downloadUrl,
  seeders: 10,
  size: 8 * 1024 ** 3,
})
const status = (hash: string, state: string, progress: number) => ({
  hash,
  name: 'x',
  state,
  progress,
  size: 1024,
  eta: 60,
  content_path: '/downloads/x',
})

describe('downloads', () => {
  it('reads info hashes from torrent files and magnets', () => {
    expect(infoHashOf(torrent)).toBe(HASH)
    expect(magnetHash('magnet:?xt=urn:btih:ZHQVOY7XELZD5GFCTXWN7LRUDOMNKMCW')).toBe(MAGNET_HASH)
  })

  it('grabs a .torrent and follows a download to completion', async () => {
    const completed: number[] = []
    ctx.on('downloads/completed', (g) => void completed.push(g.id))
    const grab = await ctx.downloads.grab(
      mediaId,
      release('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', `${base}/dl/file.torrent`),
      {
        quality: 'bluray-1080p',
        formatScore: 0,
      },
    )
    expect(grab).toMatchObject({ state: 'grabbed', downloadId: HASH })
    expect(added).toEqual([{ category: 'magpie', hasFile: true, urls: undefined }])

    torrents = [status(HASH.toUpperCase(), 'downloading', 0.5)]
    await ctx.downloads.monitor()
    expect(ctx.downloads.get(grab.id)).toMatchObject({ state: 'downloading', progress: 0.5 })

    torrents = [status(HASH, 'uploading', 1)]
    await ctx.downloads.monitor()
    expect(ctx.downloads.get(grab.id)).toMatchObject({
      state: 'import_pending',
      outputPath: '/downloads/x',
    })
    expect(completed).toEqual([grab.id])
  })

  it('sends magnets from redirects, and blocklists failed downloads', async () => {
    const title = 'Night.of.the.Living.Dead.1968.1080p.WEB-DL.x264-GRP'
    const failed: number[] = []
    ctx.on('downloads/failed', (g) => void failed.push(g.id))
    const grab = await ctx.downloads.grab(mediaId, release(title, `${base}/dl/magnet`), {
      quality: 'webdl-1080p',
      formatScore: 0,
    })
    expect(grab.downloadId).toBe(MAGNET_HASH)
    expect(added[0]!.urls).toMatch(/^magnet:/)

    // while it downloads, releases that aren't better are rejected as already downloading
    torrents = [status(MAGNET_HASH, 'downloading', 0.1)]
    await ctx.downloads.monitor()
    const target = {
      kind: 'movie' as const,
      mediaId,
      profileId: ctx.decision.profiles().find((p) => p.name === 'HD')!.id,
    }
    const same = ctx.decision.evaluate(
      { info: release('Night.of.the.Living.Dead.1968.720p.WEB-DL.x264-X', 'x') },
      target,
    )
    expect(same.rejections.map((r) => r.rule)).toEqual(['in-queue'])

    torrents = [status(MAGNET_HASH, 'error', 0.1)]
    await ctx.downloads.monitor()
    expect(ctx.downloads.get(grab.id)!.state).toBe('failed')
    expect(failed).toEqual([grab.id])
    const again = ctx.decision.evaluate({ info: release(title, 'x') }, target)
    expect(again.rejections.map((r) => r.rule)).toEqual(['blocklist'])
  })

  it('tests the client connection', async () => {
    const [client] = ctx.downloads.listClients()
    expect(await ctx.downloads.testClient(client!.id)).toEqual({
      ok: true,
      message: 'qBittorrent v5.1.0',
    })
  })
})
