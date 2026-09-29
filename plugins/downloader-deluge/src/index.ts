import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/downloads'
import type { DownloadClient, DownloadStatus } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'downloader-deluge'
export const inject = ['http', 'downloads']

export interface Config {
  name: string
  url: string
  password: string
  hostId: string
  category: string
  downloadDir: string
  priority: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  name: z.string().default('Deluge'),
  url: z
    .string()
    .default('http://localhost:8112')
    .description('Web UI URL, including any reverse-proxy path.'),
  password: z
    .string()
    .role('secret')
    .default('')
    .description('Deluge Web UI password (not the daemon password).'),
  hostId: z
    .string()
    .default('')
    .description(
      'Daemon ID from the Web UI host list; empty uses the current connection or the only configured daemon.',
    ),
  category: z
    .string()
    .default('magpie')
    .description('Label for Magpie downloads; requires the Deluge Label plugin.'),
  downloadDir: z
    .string()
    .default('')
    .description('Directory on the Deluge host; empty uses its default.'),
  priority: z.natural().default(1).description('Lower is preferred among torrent clients.'),
})

interface Torrent {
  name: string
  label: string
  state: string
  progress: number
  is_finished: boolean
  total_wanted: number
  eta: number
  save_path: string
  message: string
}

export function mapState(t: Torrent): DownloadStatus['state'] {
  if (t.state === 'Error') return 'failed'
  if (t.is_finished || t.state === 'Seeding') return 'completed'
  if (t.state === 'Paused') return 'paused'
  if (t.state === 'Downloading') return 'downloading'
  return 'queued'
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
  }
}

export function apply(ctx: Context, config: Config) {
  if (!/^[a-z0-9_-]+$/.test(config.category))
    throw new Error(
      'Deluge category must contain only lowercase letters, numbers, underscores or hyphens',
    )
  const base = config.url.replace(/\/+$/, '')
  const url = base.endsWith('/json') ? base : `${base}/json`
  const id = `deluge:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  let cookie: string | undefined
  let requestId = 0
  let loggingIn: Promise<void> | undefined
  // Tracks a partially completed add so an in-process retry can finish labeling it.
  const pending = new Set<string>()

  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await ctx.http(url, {
      method: 'POST',
      data: JSON.stringify({ method, params, id: ++requestId }),
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      validateStatus: () => true,
      timeout: 30_000,
    } as never)
    if (response.status >= 400) throw new Error(`Deluge ${method}: HTTP ${response.status}`)
    const nextCookie = /(?:^|[,;]\s*)(_session_id=[^;,\s]+)/.exec(
      response.headers.get('set-cookie') ?? '',
    )?.[1]
    if (nextCookie) cookie = nextCookie
    const body = (await response.json()) as {
      result: T
      error?: { code: number; message: string } | null
    }
    if (body.error) throw new RpcError(`Deluge ${method}: ${body.error.message}`, body.error.code)
    return body.result
  }

  async function login() {
    if (!loggingIn) {
      loggingIn = (async () => {
        cookie = undefined
        if (!(await rpc<boolean>('auth.login', [config.password])) || !cookie)
          throw new Error('Deluge Web UI login failed: check the password')
      })().finally(() => {
        loggingIn = undefined
      })
    }
    await loggingIn
  }

  async function call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!cookie) await login()
    try {
      return await rpc<T>(method, params)
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== 1) throw error
      await login()
      return rpc<T>(method, params)
    }
  }

  async function ready(createLabel = false) {
    const connected = await call<boolean>('web.connected')
    if (!connected || config.hostId) {
      const hosts = await call<[string, string, number, string][]>('web.get_hosts')
      if (connected) {
        const host = hosts.find((h) => h[0] === config.hostId)
        const status = host
          ? await call<[string, string, string]>('web.get_host_status', [config.hostId])
          : undefined
        if (status?.[1] !== 'Connected')
          throw new Error(
            'Deluge Web UI is connected to a different daemon; select the configured daemon in the Web UI',
          )
      } else {
        const host = config.hostId
          ? hosts.find((h) => h[0] === config.hostId)
          : hosts.length === 1
            ? hosts[0]
            : undefined
        if (!host) throw new Error('Select a Deluge daemon in the Web UI or configure its host ID')
        await call('web.connect', [host[0]])
        if (!(await call<boolean>('web.connected')))
          throw new Error('Deluge could not connect to the daemon')
      }
    }
    if (!(await call<string[]>('core.get_enabled_plugins')).includes('Label'))
      throw new Error('Enable the Label plugin in Deluge Preferences → Plugins')
    if (createLabel) {
      const labels = await call<string[]>('label.get_labels')
      if (!labels.includes(config.category)) {
        try {
          await call('label.add', [config.category])
        } catch (error) {
          // Another request may have created the same label in the meantime.
          if (!(await call<string[]>('label.get_labels')).includes(config.category)) throw error
        }
      }
    }
  }

  async function find(hash: string) {
    const torrents = await call<Record<string, Pick<Torrent, 'label'>>>(
      'core.get_torrents_status',
      [{ id: [hash] }, ['label']],
    )
    return torrents[hash]
  }

  const client: DownloadClient = {
    id,
    protocol: 'torrent',
    async add(payload, options) {
      if (payload.type !== 'magnet' && payload.type !== 'torrent')
        throw new Error('Deluge only downloads torrents')
      if (options.category && options.category !== config.category)
        throw new Error('Deluge category must match the configured label')
      await ready(true)
      const hash = payload.hash.toLowerCase()
      const existing = await find(hash)
      if (existing && existing.label !== config.category && !pending.has(hash))
        throw new Error('Torrent already exists outside the Magpie category')
      if (existing && !pending.has(hash)) return hash
      if (!existing) {
        const addOptions = {
          add_paused: true,
          ...(config.downloadDir && { download_location: config.downloadDir }),
        }
        const added =
          payload.type === 'magnet'
            ? await call<string | null>('core.add_torrent_magnet', [payload.uri, addOptions])
            : await call<string | null>('core.add_torrent_file', [
                'release.torrent',
                Buffer.from(payload.data).toString('base64'),
                addOptions,
              ])
        if (!added) {
          if ((await find(hash))?.label === config.category) return hash
          throw new Error(
            'Deluge did not accept the torrent, or it already exists outside the Magpie category',
          )
        }
        if (added.toLowerCase() !== hash)
          throw new Error('Deluge returned an unexpected torrent hash')
        pending.add(hash)
      }
      await call('label.set_torrent', [hash, config.category])
      if (!options.paused) await call('core.resume_torrent', [[hash]])
      pending.delete(hash)
      return hash
    },
    async list() {
      await ready()
      const torrents = await call<Record<string, Torrent>>('core.get_torrents_status', [
        { label: config.category },
        [
          'name',
          'label',
          'state',
          'progress',
          'is_finished',
          'total_wanted',
          'eta',
          'save_path',
          'message',
        ],
      ])
      return Object.entries(torrents)
        .filter(([, t]) => t.label === config.category)
        .map(([hash, t]) => ({
          downloadId: hash.toLowerCase(),
          name: t.name,
          state: mapState(t),
          progress: Math.max(0, Math.min(1, t.progress / 100)),
          sizeBytes: t.total_wanted,
          ...(t.eta > 0 && { etaSeconds: t.eta }),
          outputPath: `${t.save_path.replace(/[\\/]+$/, '')}/${t.name}`,
          ...(t.state === 'Error' && { error: t.message }),
        }))
    },
    async remove(downloadId, deleteData) {
      await ready()
      const torrent = await find(downloadId)
      if (!torrent) return
      if (torrent.label !== config.category)
        throw new Error('Torrent is outside the Magpie category')
      if (!(await call<boolean>('core.remove_torrent', [downloadId, deleteData])))
        throw new Error('Deluge did not remove the torrent')
      pending.delete(downloadId)
    },
    async test() {
      await ready(true)
      return { ok: true, message: `Deluge ${await call<string>('daemon.info')}` }
    },
  }
  ctx.downloads.register(client, {
    name: config.name,
    priority: config.priority,
    category: config.category,
  })
}
