import type { DownloadClient } from '@magpiejs/types'
import type { Context } from 'cordis'
import { expect, it, vi } from 'vitest'
import { apply, Config, mapState } from '../src/index'

const hash = 'a'.repeat(40)
const payload = {
  type: 'magnet' as const,
  hash,
  uri: `magnet:?xt=urn:btih:${hash}`,
  release: {} as never,
}
const torrent = {
  name: 'Album',
  label: 'magpie',
  state: 'Downloading',
  progress: 25,
  is_finished: false,
  total_wanted: 100,
  eta: 20,
  save_path: '/data/',
  message: '',
}
const response = (result: unknown) => Response.json({ result, error: null })
const failure = (code: number, message = 'failure') =>
  Response.json({ result: null, error: { code, message } })

function setup(handlers: Record<string, unknown | (() => unknown)> = {}, overrides = {}) {
  let client!: DownloadClient
  const defaults: Record<string, unknown> = {
    'auth.login': true,
    'web.connected': true,
    'core.get_enabled_plugins': ['Label'],
    'label.get_labels': ['magpie'],
    'core.get_torrents_status': {},
    'core.add_torrent_magnet': hash,
    'core.add_torrent_file': hash,
    'label.set_torrent': null,
    'label.add': null,
    'core.resume_torrent': null,
    'core.remove_torrent': true,
    'daemon.info': '2.1.1',
  }
  const http = vi.fn(
    async (_url: string, init: { data: string; headers: Record<string, string> }) => {
      const request = JSON.parse(init.data)
      let value = request.method in handlers ? handlers[request.method] : defaults[request.method]
      if (typeof value === 'function') value = value()
      if (value instanceof Response) return value
      if (request.method === 'auth.login')
        return Response.json(
          { result: value, error: null },
          { headers: { 'set-cookie': '_session_id=token; Path=/; HttpOnly' } },
        )
      return response(value)
    },
  )
  const register = vi.fn((value: DownloadClient) => {
    client = value
  })
  apply(
    {
      fiber: { entry: { options: { id: 'one' } } },
      http,
      downloads: { register },
    } as unknown as Context,
    Config(overrides),
  )
  const requests = () => http.mock.calls.map(([, init]) => JSON.parse(init.data))
  return { client, http, register, requests }
}

it('registers a separate instance, authenticates and creates the category when testing', async () => {
  const { client, http, register, requests } = setup(
    { 'label.get_labels': [] },
    { url: 'https://example.com/deluge/', password: 'secret' },
  )
  expect(register.mock.calls[0]![0].id).toBe('deluge:one')
  expect(await client.test()).toEqual({ ok: true, message: 'Deluge 2.1.1' })
  expect(requests()[0]).toMatchObject({ method: 'auth.login', params: ['secret'] })
  expect(requests()).toContainEqual(
    expect.objectContaining({ method: 'label.add', params: ['magpie'] }),
  )
  expect(http.mock.calls.every(([url]) => url === 'https://example.com/deluge/json')).toBe(true)
  expect(http.mock.calls[1]![1].headers.Cookie).toBe('_session_id=token')
})

it('renews an expired session once and reports login, HTTP and RPC errors', async () => {
  let attempts = 0
  const renewed = setup({
    'web.connected': () => (++attempts === 1 ? failure(1, 'Not authenticated') : true),
  })
  await renewed.client.list()
  expect(renewed.requests().filter((r) => r.method === 'auth.login')).toHaveLength(2)
  await expect(setup({ 'web.connected': () => failure(1) }).client.list()).rejects.toThrow(
    'failure',
  )
  await expect(setup({ 'auth.login': false }).client.test()).rejects.toThrow('check the password')
  await expect(setup({ 'auth.login': () => response(true) }).client.test()).rejects.toThrow(
    'login failed',
  )
  await expect(
    setup({ 'web.connected': () => new Response('', { status: 502 }) }).client.list(),
  ).rejects.toThrow('HTTP 502')
  const broken = setup({ 'core.get_enabled_plugins': () => failure(4, 'daemon unavailable') })
  await expect(broken.client.list()).rejects.toThrow('daemon unavailable')
  expect(broken.requests().filter((r) => r.method === 'auth.login')).toHaveLength(1)
})

it('reconnects the only daemon and refuses ambiguous or mismatched daemon selection', async () => {
  let connected = false
  const reconnect = setup({
    'web.connected': () => connected,
    'web.get_hosts': [['host', 'localhost', 58846, 'localclient']],
    'web.connect': () => {
      connected = true
      return []
    },
  })
  await reconnect.client.test()
  expect(reconnect.requests()).toContainEqual(
    expect.objectContaining({ method: 'web.connect', params: ['host'] }),
  )
  const selected = setup(
    {
      'web.get_hosts': [['host', 'localhost', 58846, 'localclient']],
      'web.get_host_status': ['host', 'Connected', '2.1.1'],
    },
    { hostId: 'host' },
  )
  await selected.client.test()
  expect(selected.requests()).toContainEqual(
    expect.objectContaining({ method: 'web.get_host_status', params: ['host'] }),
  )
  await expect(
    setup(
      {
        'web.get_hosts': [['host', 'localhost', 58846, 'localclient']],
        'web.get_host_status': ['host', 'Online', '2.1.1'],
      },
      { hostId: 'host' },
    ).client.test(),
  ).rejects.toThrow('different daemon')
  await expect(
    setup({ 'web.connected': false, 'web.get_hosts': [] }).client.test(),
  ).rejects.toThrow('Select a Deluge daemon')
  await expect(
    setup(
      { 'web.get_hosts': [['other', 'localhost', 58846, 'Connected']] },
      { hostId: 'host' },
    ).client.test(),
  ).rejects.toThrow('different daemon')
  await expect(setup({ 'core.get_enabled_plugins': [] }).client.test()).rejects.toThrow(
    'Enable the Label plugin',
  )
  expect(() => setup({}, { category: 'Invalid Label' })).toThrow('lowercase')
})

it('adds magnets and base64 torrent files paused, labels them, and then resumes', async () => {
  const { client, requests } = setup({}, { downloadDir: '/remote/downloads' })
  expect(await client.add(payload, {})).toBe(hash)
  const calls = requests()
  expect(calls.find((r) => r.method === 'core.add_torrent_magnet').params).toEqual([
    payload.uri,
    { add_paused: true, download_location: '/remote/downloads' },
  ])
  expect(calls.slice(-2).map((r) => [r.method, r.params])).toEqual([
    ['label.set_torrent', [hash, 'magpie']],
    ['core.resume_torrent', [[hash]]],
  ])
  const paused = setup()
  await paused.client.add(
    { ...payload, type: 'torrent', data: new Uint8Array([1, 2, 3]) },
    { paused: true },
  )
  expect(paused.requests().find((r) => r.method === 'core.add_torrent_file').params).toEqual([
    'release.torrent',
    'AQID',
    { add_paused: true },
  ])
  expect(paused.requests().some((r) => r.method === 'core.resume_torrent')).toBe(false)
})

it('reuses owned downloads, refuses foreign duplicates, and rejects unsupported payloads', async () => {
  const owned = setup({ 'core.get_torrents_status': { [hash]: { label: 'magpie' } } })
  expect(await owned.client.add(payload, {})).toBe(hash)
  expect(owned.requests().some((r) => r.method === 'core.add_torrent_magnet')).toBe(false)
  await expect(
    setup({ 'core.get_torrents_status': { [hash]: { label: 'other' } } }).client.add(payload, {}),
  ).rejects.toThrow('outside')
  await expect(setup({ 'core.add_torrent_magnet': null }).client.add(payload, {})).rejects.toThrow(
    'did not accept',
  )
  await expect(setup().client.add(payload, { category: 'other' })).rejects.toThrow(
    'configured label',
  )
  await expect(
    setup().client.add({ type: 'url', url: 'http://example.com', release: {} as never }, {}),
  ).rejects.toThrow('only downloads torrents')
})

it('finishes labeling a partially successful add on retry without another submission', async () => {
  let added = false
  let attempts = 0
  const { client, requests } = setup({
    'core.get_torrents_status': () => (added ? { [hash]: { label: '' } } : {}),
    'core.add_torrent_magnet': () => {
      added = true
      return hash
    },
    'label.set_torrent': () => (++attempts === 1 ? failure(4, 'label failure') : null),
  })
  await expect(client.add(payload, {})).rejects.toThrow('label failure')
  expect(requests().some((r) => r.method === 'core.resume_torrent')).toBe(false)
  expect(await client.add(payload, {})).toBe(hash)
  expect(requests().filter((r) => r.method === 'core.add_torrent_magnet')).toHaveLength(1)
})

it('filters and normalizes status and paths, and only removes owned torrents', async () => {
  const { client, requests } = setup({
    'core.get_torrents_status': { [hash]: torrent, foreign: { ...torrent, label: 'other' } },
  })
  expect(await client.list()).toEqual([
    {
      downloadId: hash,
      name: 'Album',
      state: 'downloading',
      progress: 0.25,
      sizeBytes: 100,
      etaSeconds: 20,
      outputPath: '/data/Album',
    },
  ])
  await client.remove(hash, true)
  expect(requests()).toContainEqual(
    expect.objectContaining({ method: 'core.remove_torrent', params: [hash, true] }),
  )
  await expect(
    setup({ 'core.get_torrents_status': { [hash]: { label: 'other' } } }).client.remove(hash, true),
  ).rejects.toThrow('outside')
  await expect(
    setup({
      'core.get_torrents_status': { [hash]: torrent },
      'core.remove_torrent': false,
    }).client.remove(hash, false),
  ).rejects.toThrow('did not remove')
  expect(mapState({ ...torrent, state: 'Error' })).toBe('failed')
  expect(mapState({ ...torrent, state: 'Seeding' })).toBe('completed')
  expect(mapState({ ...torrent, state: 'Paused', is_finished: true })).toBe('completed')
  expect(mapState({ ...torrent, state: 'Paused' })).toBe('paused')
  expect(mapState({ ...torrent, state: 'Checking' })).toBe('queued')
})
