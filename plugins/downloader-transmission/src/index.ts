// Transmission 3+ through its legacy RPC API (also supported by Transmission 4).
import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/downloads'
import type { DownloadClient, DownloadStatus } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'downloader-transmission'
export const inject = ['http', 'downloads']

export interface Config {
  name: string
  url: string
  username: string
  password: string
  category: string
  downloadDir: string
  priority: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  name: z.string().default('Transmission'),
  url: z.string().default('http://localhost:9091/transmission/rpc').description('Full RPC URL.'),
  username: z.string().default(''),
  password: z.string().role('secret').default(''),
  category: z.string().default('magpie').description('Transmission label for Magpie downloads.'),
  downloadDir: z
    .string()
    .default('')
    .description('Download directory on the Transmission host; empty uses its default.'),
  priority: z.natural().default(1).description('Lower is preferred among torrent clients.'),
})

interface Torrent {
  hashString: string
  name: string
  labels: string[]
  status: number
  percentDone: number
  metadataPercentComplete: number
  sizeWhenDone: number
  eta: number
  downloadDir: string
  isStalled: boolean
  error: number
  errorString: string
}

export function mapState(t: Torrent): DownloadStatus['state'] {
  // Tracker warnings (1/2) do not mean the download has failed; 3 is a local error.
  if (t.error === 3) return 'failed'
  if (t.metadataPercentComplete >= 1 && t.percentDone >= 1) return 'completed'
  if (t.status === 0) return 'paused'
  if (t.status !== 4) return 'queued'
  return t.isStalled ? 'stalled' : 'downloading'
}

export function apply(ctx: Context, config: Config) {
  if (!config.category.trim()) throw new Error('Transmission requires a non-empty category label')
  const id = `transmission:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  let sessionId: string | undefined

  async function call(method: string, args: Record<string, unknown> = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await ctx.http(config.url, {
        method: 'POST',
        data: JSON.stringify({ method, arguments: args }),
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId && { 'X-Transmission-Session-Id': sessionId }),
          ...((config.username || config.password) && {
            Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
          }),
        },
        validateStatus: () => true,
        timeout: 30_000,
      } as never)
      if (response.status === 409) {
        sessionId = response.headers.get('X-Transmission-Session-Id') ?? undefined
        if (!sessionId) throw new Error('Transmission did not provide a session token')
        continue
      }
      if (response.status === 401)
        throw new Error('Transmission authentication failed: check the username and password')
      if (response.status >= 400) throw new Error(`Transmission ${method}: HTTP ${response.status}`)
      const body = (await response.json()) as {
        result: string
        arguments?: Record<string, unknown>
      }
      if (body.result !== 'success') throw new Error(`Transmission ${method}: ${body.result}`)
      return body.arguments ?? {}
    }
    throw new Error('Transmission keeps rejecting the session token')
  }

  const client: DownloadClient = {
    id,
    protocol: 'torrent',
    async add(payload, options) {
      if (payload.type !== 'magnet' && payload.type !== 'torrent')
        throw new Error('Transmission only downloads torrents')
      const category = options.category ?? config.category
      if (category !== config.category)
        throw new Error('Transmission category must match the configured label')
      const existing = await call('torrent-get', {
        ids: [payload.hash],
        fields: ['hashString', 'labels'],
      })
      const torrents = existing.torrents as Pick<Torrent, 'hashString' | 'labels'>[]
      if (torrents.length) {
        if (!torrents[0]!.labels.includes(category))
          throw new Error('Torrent already exists outside the Magpie category')
        return torrents[0]!.hashString.toLowerCase()
      }
      const result = await call('torrent-add', {
        ...(payload.type === 'magnet'
          ? { filename: payload.uri }
          : { metainfo: Buffer.from(payload.data).toString('base64') }),
        labels: [category],
        paused: options.paused ?? false,
        ...(config.downloadDir && { 'download-dir': config.downloadDir }),
      })
      const added = (result['torrent-added'] ?? result['torrent-duplicate']) as
        { hashString?: string } | undefined
      if (!added?.hashString) throw new Error('Transmission did not return a torrent hash')
      // A concurrent add may have created an unrelated torrent. Never claim or relabel it.
      if (result['torrent-duplicate']) {
        const check = await call('torrent-get', { ids: [added.hashString], fields: ['labels'] })
        if (!(check.torrents as Pick<Torrent, 'labels'>[])[0]?.labels.includes(category))
          throw new Error('Torrent already exists outside the Magpie category')
      }
      return added.hashString.toLowerCase()
    },
    async list() {
      const result = await call('torrent-get', {
        fields: [
          'hashString',
          'name',
          'labels',
          'status',
          'percentDone',
          'metadataPercentComplete',
          'sizeWhenDone',
          'eta',
          'downloadDir',
          'isStalled',
          'error',
          'errorString',
        ],
      })
      return (result.torrents as Torrent[])
        .filter((t) => t.labels.includes(config.category))
        .map((t) => ({
          downloadId: t.hashString.toLowerCase(),
          name: t.name,
          state: mapState(t),
          progress: t.metadataPercentComplete < 1 ? 0 : t.percentDone,
          sizeBytes: t.sizeWhenDone,
          ...(t.eta >= 0 && { etaSeconds: t.eta }),
          outputPath: `${t.downloadDir.replace(/[\\/]+$/, '')}/${t.name}`,
          ...(t.error !== 0 && { error: t.errorString }),
        }))
    },
    async remove(downloadId, deleteData) {
      await call('torrent-remove', { ids: [downloadId], 'delete-local-data': deleteData })
    },
    async test() {
      const session = await call('session-get')
      if (typeof session['rpc-version'] !== 'number' || session['rpc-version'] < 16)
        throw new Error('Transmission 3.0 or newer is required for category labels')
      return { ok: true, message: `Transmission ${session.version}` }
    },
  }
  ctx.downloads.register(client, {
    name: config.name,
    priority: config.priority,
    category: config.category,
  })
}
