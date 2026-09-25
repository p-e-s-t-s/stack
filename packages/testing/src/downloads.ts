import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { grabs } from '@magpiejs/downloads'
import type {
  AddOptions,
  DownloadClient,
  DownloadPayload,
  DownloadStatus,
  Protocol,
} from '@magpiejs/types'
import type { Context } from 'cordis'
import { eq } from 'drizzle-orm'

export interface FakeDownloadClientOptions {
  id?: string
  protocol?: Protocol
  /** Overrides `list()`; defaults to reading `client.statuses`. */
  list?(): Promise<DownloadStatus[]> | DownloadStatus[]
}

export interface FakeDownloadClient {
  /** Pass to `ctx.downloads.register(client.client, options)`. */
  client: DownloadClient
  /** Every payload sent to `add()`, oldest first. */
  added: DownloadPayload[]
  /** What `list()` returns by default; mutate freely to simulate progress or failures. */
  statuses: DownloadStatus[]
}

/**
 * A download client that accepts anything, tracks what it was asked to download, and reports
 * whatever `statuses` currently holds (empty by default — most exit tests never poll `list()`
 * and instead "finish" downloads directly with `finishDownloads`).
 */
export function fakeDownloadClient(options: FakeDownloadClientOptions = {}): FakeDownloadClient {
  const added: DownloadPayload[] = []
  const statuses: DownloadStatus[] = []
  const client: DownloadClient = {
    id: options.id ?? 'client',
    protocol: options.protocol ?? 'torrent',
    async add(payload: DownloadPayload, _options: AddOptions) {
      added.push(payload)
      return 'hash' in payload ? payload.hash : crypto.randomUUID()
    },
    list: async () => (options.list ? options.list() : statuses),
    async remove() {},
    async test() {
      return { ok: true }
    },
  }
  return { client, added, statuses }
}

/** A grab row, as `ctx.downloads.active()` returns it. */
type Grab = ReturnType<Context['downloads']['active']>[number]

export interface FinishDownloadsOptions {
  /** The directory each grab's files land under, e.g. `join(dir, 'downloads')`. */
  dir: string
  /**
   * Files to write for a grab, keyed by path relative to its output folder; string contents are
   * written as-is. Return `undefined` to leave a grab active (e.g. a download still missing a
   * file).
   */
  files(grab: Grab): Record<string, string | Uint8Array> | undefined
  /** Which active grabs to consider; defaults to every one not already `import_failed`. */
  filter?(grab: Grab): boolean
  /** The grab's output folder name under `dir`; defaults to its title. */
  folderName?(grab: Grab): string
}

/**
 * The "download client finishes, import runs" step nearly every exit test repeats: for each
 * active grab `options.files` covers, write its files, mark it `import_pending` with its output
 * path, and import it.
 */
export async function finishDownloads(ctx: Context, options: FinishDownloadsOptions) {
  const filter = options.filter ?? ((g: Grab) => g.state !== 'import_failed')
  for (const grab of ctx.downloads.active().filter(filter)) {
    const contents = options.files(grab)
    if (!contents) continue
    const out = join(options.dir, options.folderName?.(grab) ?? grab.title)
    for (const [name, data] of Object.entries(contents)) {
      mkdirSync(join(out, name, '..'), { recursive: true })
      writeFileSync(join(out, name), data)
    }
    ctx.downloads.db
      .update(grabs)
      .set({ state: 'import_pending', outputPath: out })
      .where(eq(grabs.id, grab.id))
      .run()
    await ctx.import.importGrab(grab.id)
  }
}
