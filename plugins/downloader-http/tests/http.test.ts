import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService, { grabs } from '@magpiejs/downloads'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import { Context } from 'cordis'
import { afterAll, beforeAll, expect, it } from 'vitest'
import * as http from '../src'

const AUDIO = Buffer.from('ID3'.padEnd(5000, 'x'))
let server: Server
let base: string
const ranges: (string | undefined)[] = []
beforeAll(async () => {
  server = createServer((req, res) => {
    ranges.push(req.headers.range)
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0)
    res.writeHead(start ? 206 : 200, {
      'content-type': 'audio/mpeg',
      'content-length': String(AUDIO.length - start),
    })
    res.end(AUDIO.subarray(start))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

async function setup(dir: string) {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(http, { downloadDir: dir } as http.Config)
  return ctx
}

const addItem = (ctx: Context, dir: string) =>
  ctx.library.add({
    kind: 'movie',
    title: 'X',
    externalIds: {},
    primaryProvider: 'none',
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: ctx.library.addRootFolder(join(dir, 'lib'), 'movie').id,
    folder: 'X',
  })

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timed out')
}

it('downloads URLs through the downloads queue, and resumes after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-http-'))
  const ctx = await setup(dir)
  const item = addItem(ctx, dir)
  const grab = await ctx.downloads.grab(
    item.id,
    {
      guid: 'ep1',
      title: 'Show - Episode 1',
      protocol: 'http',
      indexerId: 'feed',
      downloadUrl: `${base}/feed/episode-1.mp3?token=1`,
    },
    { quality: 'unknown', formatScore: 0 },
  )
  await waitFor(async () => {
    await ctx.downloads.monitor()
    return ctx.downloads.get(grab.id)!.state === 'import_pending'
  })
  const done = ctx.downloads.get(grab.id)!
  expect(readFileSync(join(done.outputPath!, 'episode-1.mp3'))).toEqual(AUDIO)
  await ctx.fiber.dispose()

  // a download that was half done when Magpie stopped continues where it was
  const id = 'resume1'
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(join(dir, id, 'episode-2.mp3'), AUDIO.subarray(0, 2000))
  writeFileSync(
    join(dir, '.magpie-http.json'),
    JSON.stringify([
      {
        id,
        url: `${base}/episode-2.mp3`,
        dir: join(dir, id),
        file: 'episode-2.mp3',
        state: 'downloading',
        received: 2000,
        size: AUDIO.length,
        attempts: 0,
      },
    ]),
  )
  ranges.length = 0
  const again = await setup(dir)
  const [client] = again.downloads.listClients()
  const now = Date.now()
  const resumed = again.downloads.db
    .insert(grabs)
    .values({
      mediaId: addItem(again, dir).id,
      title: 'Show - Episode 2',
      quality: 'unknown',
      formatScore: 0,
      protocol: 'http',
      clientId: client!.id,
      downloadId: id,
      state: 'downloading',
      grabbedAt: now,
      updatedAt: now,
      lastProgressAt: now,
      release: { guid: 'ep2', title: 'x', protocol: 'http', indexerId: 'feed', downloadUrl: '' },
    })
    .returning()
    .get()
  await waitFor(async () => {
    await again.downloads.monitor()
    return again.downloads.get(resumed.id)!.state === 'import_pending'
  })
  expect(ranges).toEqual(['bytes=2000-'])
  expect(readFileSync(join(dir, id, 'episode-2.mp3'))).toEqual(AUDIO)
  await again.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})
