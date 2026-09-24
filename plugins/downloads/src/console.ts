// Web console entry: Activity (queue, recent and blocklist) and Download clients pages.

import type {} from '@magpiejs/library'
import type {} from '@magpiejs/webui'
import { QUALITY_NAMES } from '@magpiejs/decision/qualities'
import type { Context } from 'cordis'
import type { ClientHealth, DownloadsService } from './index'
import { ACTIVE_STATES, type Grab, type GrabState } from './schema'

export interface GrabRow {
  id: number
  mediaId: number
  mediaTitle: string
  title: string
  quality: string
  client: string
  state: GrabState
  progress: number
  sizeBytes: number | null
  etaSeconds: number | null
  error: string | null
  grabbedAt: number
  updatedAt: number
}

export interface DownloadsData {
  queue: GrabRow[]
  recent: GrabRow[]
  clients: ClientHealth[]
  blocklist: { id: number; mediaTitle: string; title: string; reason: string; createdAt: number }[]
  remove(id: number, options: { blocklist: boolean; deleteData: boolean }): Promise<void>
  unblock(id: number): Promise<void>
  test(clientId: string): Promise<{ ok: boolean; message?: string }>
}

export default function console_(ctx: Context, downloads: DownloadsService) {
  const title = (mediaId: number) => {
    const item = ctx.library.get(mediaId)
    return item ? `${item.title}${item.year ? ` (${item.year})` : ''}` : `#${mediaId}`
  }
  const clientName = (id: string) => downloads.listClients().find((c) => c.id === id)?.name ?? id
  const row = (g: Grab): GrabRow => ({
    id: g.id,
    mediaId: g.mediaId,
    mediaTitle: title(g.mediaId),
    title: g.title,
    quality: QUALITY_NAMES[g.quality as keyof typeof QUALITY_NAMES] ?? g.quality,
    client: clientName(g.clientId),
    state: g.state,
    progress: g.progress,
    sizeBytes: g.sizeBytes,
    etaSeconds: g.etaSeconds,
    error: g.error,
    grabbedAt: g.grabbedAt,
    updatedAt: g.updatedAt,
  })
  const snapshot = () => ({
    queue: downloads.active().map(row),
    recent: downloads
      .recent(50)
      .filter((g) => !ACTIVE_STATES.includes(g.state))
      .map(row),
    clients: downloads.listClients(),
    blocklist: downloads.blocklisted().map((b) => ({
      id: b.id,
      mediaTitle: title(b.mediaId),
      title: b.title,
      reason: b.reason,
      createdAt: b.createdAt,
    })),
  })
  const refresh = ctx.debounce(() => entry.mutate((d) => Object.assign(d, snapshot())), 200)
  for (const event of [
    'downloads/grabbed',
    'downloads/updated',
    'downloads/clients',
    'library/deleted',
  ] as const)
    ctx.on(event, refresh)

  const data: DownloadsData = {
    ...snapshot(),
    async remove(id, options) {
      await downloads.remove(id, options)
      refresh()
    },
    async unblock(id) {
      downloads.unblock(id)
      refresh()
    },
    test: (clientId) => downloads.testClient(clientId),
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/activity', '/settings/clients'],
    },
    data,
  )
}
