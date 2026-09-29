import type { DownloadClient } from '@magpiejs/types'
import type { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index'

function setup(responses: Response[]) {
  const http = vi.fn(
    async (_url: string, _init: { headers: Record<string, string>; data?: unknown }) => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected HTTP request')
      return response
    },
  )
  let client!: DownloadClient
  const ctx = {
    fiber: {},
    http,
    downloads: {
      register: (registered: DownloadClient) => {
        client = registered
      },
    },
  } as unknown as Context
  apply(ctx, {
    name: 'qBittorrent',
    url: 'http://localhost:8081/',
    username: 'admin',
    password: 'secret',
    category: 'magpie',
    priority: 1,
  } satisfies Config)
  return { client, http }
}
const denied = () => new Response('Forbidden', { status: 403 })
const login = (sid = 'session') =>
  new Response('Ok.', { headers: { 'set-cookie': `SID=${sid}; HttpOnly; path=/` } })

describe('qBittorrent authentication', () => {
  it('supports localhost/whitelisted auth bypass without login or a cookie', async () => {
    const { client, http } = setup([new Response('v5.2.4'), new Response('')])
    expect(await client.test()).toEqual({ ok: true, message: 'qBittorrent v5.2.4' })
    expect(http.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost:8081/api/v2/app/version',
      'http://localhost:8081/api/v2/torrents/createCategory',
    ])
    expect(
      http.mock.calls.every((call) => !('Cookie' in (call[1] as { headers: object }).headers)),
    ).toBe(true)
  })
  it('logs in when required and reuses the SID', async () => {
    const { client, http } = setup([denied(), login(), new Response('[]'), new Response('[]')])
    await client.list()
    await client.list()
    expect(http.mock.calls[1]?.[0]).toBe('http://localhost:8081/api/v2/auth/login')
    expect((http.mock.calls[1]?.[1] as { data: URLSearchParams }).data.get('username')).toBe(
      'admin',
    )
    expect((http.mock.calls[2]?.[1] as { headers: { Cookie: string } }).headers.Cookie).toBe(
      'SID=session',
    )
    expect((http.mock.calls[3]?.[1] as { headers: { Cookie: string } }).headers.Cookie).toBe(
      'SID=session',
    )
  })
  it('renews an expired session and bounds retries', async () => {
    const { client, http } = setup([
      denied(),
      login(),
      new Response('[]'),
      denied(),
      login('renewed'),
      new Response('[]'),
    ])
    await client.list()
    await client.list()
    expect((http.mock.calls[5]?.[1] as { headers: { Cookie: string } }).headers.Cookie).toBe(
      'SID=renewed',
    )
    const rejected = setup([denied(), login(), denied()])
    await expect(rejected.client.list()).rejects.toThrow('keeps rejecting the session')
    expect(rejected.http).toHaveBeenCalledTimes(3)
  })
  it('reports invalid credentials and login server errors distinctly', async () => {
    await expect(setup([denied(), new Response('Fails.')]).client.list()).rejects.toThrow(
      'check the username and password',
    )
    await expect(
      setup([denied(), new Response('Error', { status: 500 })]).client.list(),
    ).rejects.toThrow('login: HTTP 500')
  })
  it('does not attempt login for unrelated API errors', async () => {
    const { client, http } = setup([new Response('Not found', { status: 404 })])
    await expect(client.list()).rejects.toThrow('HTTP 404')
    expect(http).toHaveBeenCalledTimes(1)
  })
})

describe('qBittorrent grab retries', () => {
  const hash = '71754637fd29b4be433723a4a559086e2bc083dc'
  const payload = {
    type: 'magnet' as const,
    hash,
    uri: `magnet:?xt=urn:btih:${hash}`,
    release: {
      guid: hash,
      title: 'Movie',
      protocol: 'torrent' as const,
      indexerId: 'test',
      downloadUrl: `magnet:?xt=urn:btih:${hash}`,
    },
  }
  it('adopts an existing torrent in the configured category without submitting again', async () => {
    const { client, http } = setup([Response.json([{ hash }])])
    expect(await client.add(payload, {})).toBe(hash)
    expect(http).toHaveBeenCalledTimes(1)
    expect(http.mock.calls[0]?.[0]).toContain(`hashes=${hash}&category=magpie`)
  })
  it('returns the modern successful add ID to the downloads tracker', async () => {
    const { client, http } = setup([
      Response.json([]),
      Response.json({
        success_count: 1,
        failure_count: 0,
        pending_count: 0,
        added_torrent_ids: [hash],
      }),
    ])
    expect(await client.add(payload, {})).toBe(hash)
    expect(http.mock.calls[1]?.[0]).toContain('/torrents/add')
  })
})
