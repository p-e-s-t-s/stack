import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One `<category>`, optionally with subcategories (e.g. Movies/HD). */
export interface FakeTorznabCategory {
  id: number
  name: string
  subcats?: { id: number; name: string }[]
}

/**
 * Which search modes the fake indexer advertises in its capabilities, and the parameters each
 * accepts. Plain `search` is always advertised (with `q`, unless overridden); the others are
 * left out of the capabilities entirely when omitted, matching a real indexer that doesn't
 * support that mode.
 */
export interface FakeTorznabCaps {
  search?: string[]
  movie?: string[]
  tv?: string[]
  music?: string[]
  book?: string[]
  categories?: FakeTorznabCategory[]
}

/** One release in the fake indexer's results, as a friendlier shape than raw Torznab XML. */
export interface FakeTorznabItem {
  title: string
  /** Default: the title. */
  guid?: string
  /** Default: a magnet link built from `hash`, else a fake `.torrent` URL. */
  link?: string
  /** Info hash for the default magnet link; ignored if `link` is given. */
  hash?: string
  size?: number
  seeders?: number
  peers?: number
  pubDate?: string
  /** Extra `torznab:attr`s, e.g. `{ imdbid: '0063350', downloadvolumefactor: 0 }`. */
  attrs?: Record<string, string | number>
}

export interface FakeTorznabOptions {
  caps?: FakeTorznabCaps
  /** Called for every non-caps request; the query is also recorded in `requests`. */
  items(query: URLSearchParams): FakeTorznabItem[]
  /** When set, requests with a different (or missing) `apikey` get a Torznab error response. */
  apiKey?: string
}

export interface FakeTorznab {
  /** Base URL, e.g. `http://127.0.0.1:54321`; indexer configs use `${url}/api`. */
  url: string
  /** Every search/RSS request's query string, oldest first (caps requests aren't recorded). */
  requests: URLSearchParams[]
  close(): void
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderCaps(caps: FakeTorznabCaps = {}) {
  const mode = (tag: string, params?: string[]) =>
    params ? `<${tag} available="yes" supportedParams="${params.join(',')}"/>` : ''
  const category = (c: FakeTorznabCategory): string =>
    `<category id="${c.id}" name="${escape(c.name)}">${(c.subcats ?? [])
      .map((s) => `<subcat id="${s.id}" name="${escape(s.name)}"/>`)
      .join('')}</category>`
  return `<caps><searching>
    ${mode('search', caps.search ?? ['q'])}
    ${mode('movie-search', caps.movie)}
    ${mode('tv-search', caps.tv)}
    ${mode('music-search', caps.music)}
    ${mode('book-search', caps.book)}
  </searching><categories>${(caps.categories ?? []).map(category).join('')}</categories></caps>`
}

function renderItem(item: FakeTorznabItem) {
  const guid = item.guid ?? item.title
  const link =
    item.link ??
    (item.hash
      ? `magnet:?xt=urn:btih:${item.hash}`
      : `http://x/${encodeURIComponent(item.title)}.torrent`)
  const attrs = { ...item.attrs }
  if (item.seeders !== undefined) attrs.seeders = item.seeders
  if (item.peers !== undefined) attrs.peers = item.peers
  return `<item><title>${escape(item.title)}</title><guid>${escape(guid)}</guid>
    <link>${escape(link)}</link>
    ${item.size !== undefined ? `<size>${item.size}</size>` : ''}
    ${item.pubDate ? `<pubDate>${escape(item.pubDate)}</pubDate>` : ''}
    ${Object.entries(attrs)
      .map(([k, v]) => `<torznab:attr name="${k}" value="${escape(String(v))}"/>`)
      .join('')}
  </item>`
}

/**
 * A fake Torznab/Newznab HTTP server: answers `t=caps` from `options.caps`, and every other
 * request with the items `options.items(query)` returns. Point `@magpiejs/indexer-torznab` at
 * `${fake.url}/api`. Always call `fake.close()` (e.g. in `afterAll`) to release the port.
 */
export async function fakeTorznab(options: FakeTorznabOptions): Promise<FakeTorznab> {
  const requests: URLSearchParams[] = []
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (options.apiKey !== undefined && url.searchParams.get('apikey') !== options.apiKey) {
      return res.end('<error code="100" description="Incorrect user credentials"/>')
    }
    if (url.searchParams.get('t') === 'caps') return res.end(renderCaps(options.caps))
    requests.push(url.searchParams)
    const items = options.items(url.searchParams)
    res.end(
      `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items
        .map(renderItem)
        .join('')}</channel></rss>`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests, close: () => server.close() }
}
