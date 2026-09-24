// @magpiejs/downloader-http: a download client for plain URLs (the `http` protocol), such as
// podcast episodes. Files go to their own folder per download under `downloadDir`; progress
// is kept in a small state file there, so downloads resume after a restart.

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/downloads'
import type { DownloadClient, DownloadStatus } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'downloader-http'
export const inject = ['downloads', 'http']

export interface Config {
  name: string
  downloadDir: string
  concurrency: number
  retries: number
  priority: number
}

export const Config: z<Config> = z.object({
  name: z.string().default('Direct downloads').description('Name shown in Magpie.'),
  downloadDir: z
    .string()
    .default('downloads')
    .description("Where files are downloaded, relative to Magpie's config folder unless absolute."),
  concurrency: z.natural().min(1).default(2).description('Downloads at the same time.'),
  retries: z.natural().default(3).description('Retries after a network error.'),
  priority: z
    .natural()
    .default(1)
    .description('Lower is preferred when several direct-download clients are enabled.'),
})

interface Entry {
  id: string
  url: string
  /** Folder of this download (the reported output path). */
  dir: string
  file?: string
  state: 'queued' | 'downloading' | 'completed' | 'failed'
  received: number
  size?: number
  attempts: number
  error?: string
}

const STATE_FILE = '.magpie-http.json'

/** A file name for a URL: its last path segment, or a fallback. */
export function fileNameFor(url: string, contentType?: string | null) {
  let name = ''
  try {
    name = decodeURIComponent(basename(new URL(url).pathname))
  } catch {
    // not a valid URL or escape: fall back below
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()
  if (!name || !name.includes('.')) {
    const ext = contentType?.includes('mpeg')
      ? '.mp3'
      : contentType?.includes('mp4') || contentType?.includes('m4a')
        ? '.m4a'
        : ''
    name = (name || 'download') + ext
  }
  return name
}

export function apply(ctx: Context, config: Config) {
  const id = `http:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
  const base = ctx.root.baseUrl ? fileURLToPath(ctx.root.baseUrl) : process.cwd()
  const root = resolve(base, config.downloadDir)
  mkdirSync(root, { recursive: true })
  const stateFile = join(root, STATE_FILE)

  const entries = new Map<string, Entry>()
  if (existsSync(stateFile)) {
    try {
      for (const e of JSON.parse(readFileSync(stateFile, 'utf8')) as Entry[]) entries.set(e.id, e)
    } catch (error) {
      ctx.logger.warn('could not read %s: %s', stateFile, error)
    }
  }

  let saving = Promise.resolve()
  const save = () =>
    (saving = saving.then(async () => {
      const tmp = `${stateFile}.tmp`
      await writeFile(tmp, JSON.stringify([...entries.values()], null, 2))
      await rename(tmp, stateFile)
    }))

  const running = new Map<string, AbortController>()
  let disposed = false

  /** Starts queued downloads up to the concurrency limit. */
  function pump() {
    if (disposed) return
    for (const entry of entries.values()) {
      if (running.size >= config.concurrency) return
      if (entry.state === 'queued' && !running.has(entry.id)) void run(entry)
    }
  }

  async function run(entry: Entry) {
    const controller = new AbortController()
    running.set(entry.id, controller)
    entry.state = 'downloading'
    mkdirSync(entry.dir, { recursive: true })
    try {
      // resume a partial file when the server supports ranges
      const partial = entry.file ? join(entry.dir, entry.file) : undefined
      const have = partial && existsSync(partial) ? statSync(partial).size : 0
      // through the http service, so its proxy setting applies
      const response = await ctx.http(entry.url, {
        headers: have ? { Range: `bytes=${have}-` } : {},
        signal: controller.signal,
        redirect: 'follow',
        validateStatus: () => true,
      } as never)
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const resumed = have > 0 && response.status === 206
      if (!entry.file)
        entry.file = fileNameFor(response.url || entry.url, response.headers.get('content-type'))
      const length = Number(response.headers.get('content-length')) || undefined
      entry.size = length ? (resumed ? have + length : length) : entry.size
      entry.received = resumed ? have : 0
      await save()

      const body = Readable.fromWeb(response.body as never)
      body.on('data', (chunk: Buffer) => (entry.received += chunk.length))
      await pipeline(
        body,
        createWriteStream(join(entry.dir, entry.file), { flags: resumed ? 'a' : 'w' }),
      )
      entry.size ??= entry.received
      entry.state = 'completed'
      entry.error = undefined
    } catch (error) {
      if (disposed || controller.signal.aborted) return
      entry.attempts += 1
      entry.error = error instanceof Error ? error.message : String(error)
      entry.state = entry.attempts > config.retries ? 'failed' : 'queued'
      ctx.logger.warn('download of %s failed (%s): %s', entry.url, entry.attempts, entry.error)
      // back off before the next attempt
      if (entry.state === 'queued')
        await new Promise((r) => setTimeout(r, 2 ** entry.attempts * 1000))
    } finally {
      running.delete(entry.id)
      if (!disposed) {
        await save()
        pump()
      }
    }
  }

  const client: DownloadClient = {
    id,
    protocol: 'http',

    async add(payload) {
      if (payload.type !== 'url') throw new Error('the direct-download client only takes URLs')
      const downloadId = createHash('sha1').update(payload.url).digest('hex').slice(0, 20)
      const existing = entries.get(downloadId)
      if (!existing || existing.state === 'failed') {
        entries.set(downloadId, {
          id: downloadId,
          url: payload.url,
          dir: join(root, downloadId),
          state: 'queued',
          received: 0,
          attempts: 0,
        })
        await save()
        pump()
      }
      return downloadId
    },

    async list(): Promise<DownloadStatus[]> {
      return [...entries.values()].map((e) => ({
        downloadId: e.id,
        name: e.file ?? e.url,
        state: e.state,
        progress: e.state === 'completed' ? 1 : e.size ? e.received / e.size : 0,
        sizeBytes: e.size,
        outputPath: e.dir,
        error: e.error,
      }))
    },

    async remove(downloadId, deleteData) {
      running.get(downloadId)?.abort()
      const entry = entries.get(downloadId)
      entries.delete(downloadId)
      if (entry && deleteData) rmSync(entry.dir, { recursive: true, force: true })
      await save()
      pump()
    },

    async test() {
      const probe = join(root, '.magpie-write-test')
      await writeFile(probe, '')
      rmSync(probe, { force: true })
      return { ok: true, message: `downloading to ${root}` }
    },
  }

  ctx.downloads.register(client, { name: config.name, priority: config.priority, category: '' })
  // downloads that were running when Magpie stopped start again
  for (const entry of entries.values()) if (entry.state === 'downloading') entry.state = 'queued'
  pump()
  ctx.effect(
    () => () => {
      disposed = true
      for (const controller of running.values()) controller.abort()
    },
    'downloader-http',
  )
}
