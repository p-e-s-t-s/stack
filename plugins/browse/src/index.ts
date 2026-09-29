import type {} from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import type {} from '@magpiejs/webui'
import type { DiscoveryFeed, MetadataSearchResult } from '@magpiejs/types'
import { type Context, Service } from 'cordis'

export interface BrowseFeed extends DiscoveryFeed {
  providerId: string
}
export interface BrowseItem extends MetadataSearchResult {
  link?: string
  inLibrary: boolean
}
export interface BrowseData {
  enabled: boolean
  feeds: BrowseFeed[]
  revision: number
  load(providerId: string, feedId: string, region: string): Promise<BrowseItem[]>
}

declare module 'cordis' {
  interface Context {
    browse: BrowseService
  }
}

export class BrowseService extends Service {
  static inject = ['library', 'metadata']
  private cache = new Map<string, { expires: number; items: Promise<MetadataSearchResult[]> }>()
  constructor(ctx: Context) {
    super(ctx, 'browse')
  }

  [Service.init]() {
    this.ctx.on('metadata/providers', () => this.cache.clear())
    this.ctx.inject(['webui'], (ctx) => {
      const snapshot = () => ({
        enabled: ctx.library.kinds().some((k) => k.browse),
        feeds: this.feeds(),
      })
      const entry = ctx.webui.addEntry(
        {
          baseUrl: import.meta.url,
          source: '../client/index.ts',
          manifest: '../dist/manifest.json',
          routes: ['/browse'],
        },
        {
          ...snapshot(),
          revision: 0,
          load: (providerId, feedId, region) => this.load(providerId, feedId, region),
        } satisfies BrowseData,
      )
      for (const event of [
        'library/kinds',
        'metadata/providers',
        'library/added',
        'library/deleted',
      ] as const)
        ctx.on(event, () =>
          entry.mutate((d) => {
            Object.assign(d, snapshot())
            d.revision++
          }),
        )
    })
  }

  feeds(): BrowseFeed[] {
    const kinds = new Set(
      this.ctx.library
        .kinds()
        .filter((k) => k.browse)
        .map((k) => k.id),
    )
    return this.ctx.metadata
      .discovery()
      .flatMap((p) =>
        p
          .discoveryFeeds!.filter((f) => kinds.has(f.kind) && p.kinds.includes(f.kind))
          .map((f) => ({ ...f, providerId: p.id })),
      )
  }

  async load(providerId: string, feedId: string, region: string): Promise<BrowseItem[]> {
    const feed = this.feeds().find((f) => f.id === feedId && f.providerId === providerId)
    if (!feed) throw new Error('This discovery feed is no longer enabled')
    if (!/^[A-Z]{2}$/.test(region)) throw new Error('Choose a two-letter country code')
    const provider = this.ctx.metadata.get(providerId)!
    const key = JSON.stringify([providerId, feedId, region])
    let cached = this.cache.get(key)
    if (!cached || cached.expires <= Date.now()) {
      const items = provider.discover!(feedId, region)
      cached = { expires: Date.now() + 15 * 60_000, items }
      this.cache.set(key, cached)
      // Bound caches even when clients request many regions.
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!)
      const current = cached
      void items.catch(() => {
        if (this.cache.get(key) === current) this.cache.delete(key)
      })
    }
    const results = await cached.items
    // Re-check after remote work: a disabled plugin must not leak stale cards/actions.
    if (
      !this.feeds().some((f) => f.id === feedId && f.providerId === providerId) ||
      this.ctx.metadata.get(providerId) !== provider
    )
      return []
    const kind = this.ctx.library.kinds().find((k) => k.id === feed.kind)!
    const library = this.ctx.library.list(feed.kind)
    return results
      .filter((r) => r.kind === feed.kind)
      .map((r) => {
        const existing = library.find((item) =>
          Object.entries(r.ids).some(
            ([key, id]) => !!id && item.externalIds[key as keyof typeof r.ids] === id,
          ),
        )
        return {
          ...r,
          inLibrary: !!existing,
          link: existing
            ? `${kind.browse!.detailPath}/${existing.id}`
            : `${kind.browse!.addPath}?q=${encodeURIComponent(r.title)}`,
        }
      })
  }
}

export default BrowseService
