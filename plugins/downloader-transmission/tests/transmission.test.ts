import type { DownloadClient } from '@magpiejs/types'
import type { Context } from 'cordis'
import { expect, it, vi } from 'vitest'
import { apply, Config, mapState } from '../src/index'

const ok = (args: object = {}) => Response.json({ result: 'success', arguments: args })
const token = (value: string) =>
  new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': value } })
function setup(responses: Response[], overrides = {}) {
  let client!: DownloadClient
  const http = vi.fn(
    async (_url: string, _init: { data: string; headers: Record<string, string> }) => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    },
  )
  const register = vi.fn((value: DownloadClient) => {
    client = value
  })
  apply(
    {
      fiber: { entry: { options: { id: 'instance' } } },
      http,
      downloads: { register },
    } as unknown as Context,
    Config(overrides),
  )
  return { client, http, register, request: (n: number) => JSON.parse(http.mock.calls[n]![1].data) }
}
const hash = 'a'.repeat(40)
const payload = {
  type: 'magnet' as const,
  uri: `magnet:?xt=urn:btih:${hash}`,
  hash,
  release: {} as never,
}

it('registers an independent instance and negotiates and renews session tokens with Basic auth', async () => {
  const { client, http, register } = setup(
    [
      token('first'),
      ok({ version: '4.0.6', 'rpc-version': 17 }),
      token('renewed'),
      ok({ torrents: [] }),
    ],
    { username: 'user', password: 'secret' },
  )
  expect(register.mock.calls[0]![0].id).toBe('transmission:instance')
  expect(await client.test()).toEqual({ ok: true, message: 'Transmission 4.0.6' })
  await client.list()
  expect(http.mock.calls[1]![1].headers['X-Transmission-Session-Id']).toBe('first')
  expect(http.mock.calls[3]![1].headers['X-Transmission-Session-Id']).toBe('renewed')
  expect(http.mock.calls[0]![1].headers.Authorization).toBe(
    `Basic ${Buffer.from('user:secret').toString('base64')}`,
  )
})

it('bounds token retries and reports authentication, HTTP, RPC and version failures', async () => {
  await expect(setup([token('a'), token('b'), token('c')]).client.test()).rejects.toThrow(
    'keeps rejecting',
  )
  await expect(setup([new Response('', { status: 409 })]).client.test()).rejects.toThrow(
    'did not provide',
  )
  await expect(setup([new Response('', { status: 401 })]).client.test()).rejects.toThrow(
    'authentication failed',
  )
  await expect(setup([new Response('', { status: 500 })]).client.list()).rejects.toThrow('HTTP 500')
  await expect(
    setup([Response.json({ result: 'invalid argument' })]).client.list(),
  ).rejects.toThrow('invalid argument')
  await expect(setup([ok({ 'rpc-version': 15 })]).client.test()).rejects.toThrow('3.0 or newer')
})

it('adds magnets and base64 torrents with labels, pause and remote directory settings', async () => {
  const { client, request } = setup(
    [
      ok({ torrents: [] }),
      ok({ 'torrent-added': { hashString: hash.toUpperCase() } }),
      ok({ torrents: [] }),
      ok({ 'torrent-added': { hashString: hash } }),
    ],
    { downloadDir: '/data' },
  )
  expect(await client.add(payload, { paused: true })).toBe(hash)
  expect(request(1)).toEqual({
    method: 'torrent-add',
    arguments: { filename: payload.uri, labels: ['magpie'], paused: true, 'download-dir': '/data' },
  })
  await client.add({ ...payload, type: 'torrent', data: new Uint8Array([1, 2, 3]) }, {})
  expect(request(3).arguments.metainfo).toBe('AQID')
})

it('adopts owned torrents on retries and leaves unrelated duplicates alone', async () => {
  const owned = setup([ok({ torrents: [{ hashString: hash, labels: ['magpie'] }] })])
  expect(await owned.client.add(payload, {})).toBe(hash)
  expect(owned.http).toHaveBeenCalledTimes(1)
  await expect(
    setup([ok({ torrents: [{ hashString: hash, labels: ['other'] }] })]).client.add(payload, {}),
  ).rejects.toThrow('outside')
  await expect(
    setup([
      ok({ torrents: [] }),
      ok({ 'torrent-duplicate': { hashString: hash } }),
      ok({ torrents: [{ labels: ['other'] }] }),
    ]).client.add(payload, {}),
  ).rejects.toThrow('outside')
  expect(
    await setup([
      ok({ torrents: [] }),
      ok({ 'torrent-duplicate': { hashString: hash } }),
      ok({ torrents: [{ labels: ['magpie'] }] }),
    ]).client.add(payload, {}),
  ).toBe(hash)
  await expect(
    setup([]).client.add({ type: 'url', url: 'http://example.com', release: {} as never }, {}),
  ).rejects.toThrow('only downloads torrents')
})

it('filters by label and reports completed paths, unknown ETA and tracker warnings', async () => {
  const torrent = {
    hashString: hash,
    name: 'Album',
    labels: ['magpie'],
    status: 6,
    percentDone: 1,
    metadataPercentComplete: 1,
    sizeWhenDone: 100,
    eta: -1,
    downloadDir: '/data/',
    isStalled: false,
    error: 2,
    errorString: 'Tracker unavailable',
  }
  const { client, request } = setup([
    ok({ torrents: [torrent, { ...torrent, labels: ['other'] }] }),
    ok(),
  ])
  expect(await client.list()).toEqual([
    {
      downloadId: hash,
      name: 'Album',
      state: 'completed',
      progress: 1,
      sizeBytes: 100,
      outputPath: '/data/Album',
      error: 'Tracker unavailable',
    },
  ])
  await client.remove(hash, true)
  expect(request(1)).toEqual({
    method: 'torrent-remove',
    arguments: { ids: [hash], 'delete-local-data': true },
  })
  expect(mapState({ ...torrent, status: 0, percentDone: 0 })).toBe('paused')
  expect(mapState({ ...torrent, status: 3, percentDone: 0 })).toBe('queued')
  expect(mapState({ ...torrent, status: 4, percentDone: 0, isStalled: true })).toBe('stalled')
  expect(mapState({ ...torrent, status: 4, percentDone: 0 })).toBe('downloading')
  expect(mapState({ ...torrent, error: 3 })).toBe('failed')
  expect(mapState({ ...torrent, status: 4, metadataPercentComplete: 0 })).toBe('downloading')
})
