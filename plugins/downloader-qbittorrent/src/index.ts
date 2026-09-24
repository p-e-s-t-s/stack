// @magpiejs/downloader-qbittorrent: qBittorrent via its Web API (v2).

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/downloads'
import type { DownloadClient, DownloadStatus } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'downloader-qbittorrent'
export const inject = ['http', 'downloads']

export interface Config {
  name: string
  url: string
  username: string
  password: string
  category: string
  priority: number
}

export const Config: z<Config> = z.object({
  name: z.string().default('qBittorrent').description('Name shown in Magpie.'),
  url: z.string().default('http://localhost:8080').description('Web UI address.'),
  username: z.string().default('admin'),
  password: z.string().role('secret').default(''),
  category: z.string().default('magpie').description("Category for Magpie's downloads."),
  priority: z
    .natural()
    .default(1)
    .description('Lower is preferred when several torrent clients are enabled.'),
})

interface Torrent {
  hash: string
  name: string
  state: string
  progress: number
  size: number
  eta: number
  content_path?: string
  save_path?: string
}

const COMPLETED = new Set([
  'uploading',
  'stalledUP',
  'pausedUP',
  'stoppedUP',
  'queuedUP',
  'forcedUP',
  'checkingUP',
])
const QUEUED = new Set([
  'queuedDL',
  'metaDL',
  'forcedMetaDL',
  'checkingDL',
  'allocating',
  'checkingResumeData',
  'moving',
])

export function mapState(t: Torrent): DownloadStatus['state'] {
  if (t.state === 'error' || t.state === 'missingFiles') return 'failed'
  if (COMPLETED.has(t.state) || t.progress >= 1) return 'completed'
  if (t.state === 'stalledDL') return 'stalled'
  if (t.state === 'pausedDL' || t.state === 'stoppedDL') return 'paused'
  if (QUEUED.has(t.state)) return 'queued'
  return 'downloading'
}

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; data: Uint8Array; type: string }

/** Builds a multipart/form-data body by hand, so it works with any fetch implementation. */
export function multipart(parts: Part[]) {
  const boundary = `----magpie${Math.random().toString(16).slice(2)}`
  const chunks: Uint8Array[] = []
  const text = (s: string) => chunks.push(Buffer.from(s, 'utf8'))
  for (const part of parts) {
    text(`--${boundary}\r\n`)
    if ('data' in part) {
      text(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`,
      )
      chunks.push(part.data)
    } else {
      text(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}`)
    }
    text('\r\n')
  }
  text(`--${boundary}--\r\n`)
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

export function apply(ctx: Context, config: Config) {
  const base = config.url.replace(/\/+$/, '')
  const id = `qbittorrent:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  let cookie: string | undefined

  async function login() {
    const response = await ctx.http(`${base}/api/v2/auth/login`, {
      method: 'POST',
      data: new URLSearchParams({ username: config.username, password: config.password }),
      headers: { Referer: base },
      validateStatus: () => true,
    } as never)
    const text = await response.text()
    const sid = /SID=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0]
    if (response.status === 403)
      throw new Error('qBittorrent refused the login (too many failed attempts?)')
    if (!sid || text.trim() !== 'Ok.')
      throw new Error('qBittorrent login failed: check the username and password')
    cookie = sid
  }

  /** Calls the API, logging in first and again when the session has expired. */
  async function call(
    path: string,
    init: { method?: string; data?: unknown; contentType?: string } = {},
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!cookie) await login()
      const response = await ctx.http(`${base}/api/v2${path}`, {
        method: init.method ?? 'GET',
        data: init.data,
        headers: {
          Cookie: cookie!,
          Referer: base,
          ...(init.contentType && { 'Content-Type': init.contentType }),
        },
        validateStatus: () => true,
        timeout: 30_000,
      } as never)
      if (response.status === 403) {
        cookie = undefined
        continue
      }
      if (response.status >= 400)
        throw new Error(`qBittorrent ${path}: HTTP ${response.status} ${await response.text()}`)
      return response
    }
    throw new Error('qBittorrent keeps rejecting the session')
  }

  const client: DownloadClient = {
    id,
    protocol: 'torrent',

    async add(payload, options) {
      if (payload.type === 'nzb') throw new Error('qBittorrent cannot download usenet releases')
      if (payload.type === 'url') throw new Error('qBittorrent only downloads torrents')
      const parts: Part[] = [
        payload.type === 'magnet'
          ? { name: 'urls', value: payload.uri }
          : {
              name: 'torrents',
              filename: 'release.torrent',
              data: payload.data,
              type: 'application/x-bittorrent',
            },
        { name: 'category', value: options.category ?? config.category },
      ]
      if (options.paused) parts.push({ name: 'paused', value: 'true' })
      const { body, contentType } = multipart(parts)
      const response = await call('/torrents/add', { method: 'POST', data: body, contentType })
      const text = (await response.text()).trim()
      if (text && text !== 'Ok.') throw new Error(`qBittorrent did not accept the torrent: ${text}`)
      return payload.hash
    },

    async list() {
      const response = await call(`/torrents/info?category=${encodeURIComponent(config.category)}`)
      const torrents = (await response.json()) as Torrent[]
      return torrents.map((t) => ({
        downloadId: t.hash.toLowerCase(),
        name: t.name,
        state: mapState(t),
        progress: t.progress,
        sizeBytes: t.size,
        etaSeconds: t.eta,
        outputPath:
          t.content_path ??
          (t.save_path ? `${t.save_path.replace(/\/+$/, '')}/${t.name}` : undefined),
        ...(t.state === 'error' && { error: 'qBittorrent reports an error' }),
        ...(t.state === 'missingFiles' && { error: 'files are missing' }),
      }))
    },

    async remove(downloadId, deleteData) {
      await call('/torrents/delete', {
        method: 'POST',
        data: new URLSearchParams({ hashes: downloadId, deleteFiles: String(deleteData) }),
      })
    },

    async test() {
      cookie = undefined
      const version = await (await call('/app/version')).text()
      // make sure the category exists so downloads land in it
      await call('/torrents/createCategory', {
        method: 'POST',
        data: new URLSearchParams({ category: config.category }),
      }).catch(() => {})
      return { ok: true, message: `qBittorrent ${version.trim()}` }
    },
  }

  ctx.downloads.register(client, {
    name: config.name,
    priority: config.priority,
    category: config.category,
  })
}
