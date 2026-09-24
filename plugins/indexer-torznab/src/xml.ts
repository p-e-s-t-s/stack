import { XMLParser } from 'fast-xml-parser'
import type { IndexerCaps, ReleaseInfo } from '@magpiejs/types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
})

const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]
const text = (value: unknown): string | undefined =>
  value === undefined || value === null
    ? undefined
    : typeof value === 'object'
      ? text((value as Record<string, unknown>)['#text'])
      : String(value)

export class TorznabError extends Error {}

function checkError(doc: Record<string, any>) {
  const error = doc.error
  if (error)
    throw new TorznabError(
      `${error['@_description'] ?? 'indexer error'} (code ${error['@_code'] ?? '?'})`,
    )
}

/** Capabilities: categories, and the parameters of each search mode it offers. */
export function parseCaps(xml: string): IndexerCaps {
  const doc = parser.parse(xml)
  checkError(doc)
  const caps = doc.caps ?? {}
  const searching = caps.searching ?? {}
  const params = (node: any) =>
    node?.['@_available'] === 'yes'
      ? String(node['@_supportedParams'] ?? 'q')
          .split(',')
          .map((p: string) => p.trim())
      : []
  const categories = list(caps.categories?.category).flatMap((c: any) => [
    { id: Number(c['@_id']), name: String(c['@_name']) },
    ...list(c.subcat).map((s: any) => ({
      id: Number(s['@_id']),
      name: `${c['@_name']}/${s['@_name']}`,
    })),
  ])
  const music = params(searching['music-search'])
  return {
    categories,
    searchParams: {
      search: params(searching.search),
      movie: params(searching['movie-search']),
      tv: params(searching['tv-search']),
      // Newznab calls it audio-search, Torznab music-search
      music: music.length ? music : params(searching['audio-search']),
      book: params(searching['book-search']),
    },
  }
}

export function parseResults(
  xml: string,
  indexerId: string,
  protocol: 'torrent' | 'usenet',
): ReleaseInfo[] {
  const doc = parser.parse(xml)
  checkError(doc)
  const items = list(doc.rss?.channel?.item)
  return items.flatMap((item: any): ReleaseInfo[] => {
    const attrs = new Map<string, string>()
    for (const a of [...list(item['torznab:attr']), ...list(item['newznab:attr'])]) {
      attrs.set(String(a['@_name']).toLowerCase(), String(a['@_value']))
    }
    const title = text(item.title)
    const enclosure = list(item.enclosure)[0]
    const downloadUrl = enclosure?.['@_url'] ?? text(item.link) ?? attrs.get('magneturl')
    if (!title || !downloadUrl) return []
    const num = (v?: string) =>
      v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v)
    const flags: string[] = []
    if (attrs.get('downloadvolumefactor') === '0') flags.push('freeleech')
    else if (attrs.get('downloadvolumefactor') === '0.5') flags.push('halfleech')
    const imdb = attrs.get('imdbid') ?? attrs.get('imdb')
    const pubDate = text(item.pubDate)
    return [
      {
        guid: text(item.guid) ?? downloadUrl,
        title,
        protocol,
        indexerId,
        downloadUrl,
        infoUrl: text(item.comments) ?? text(item.link),
        size: num(attrs.get('size')) ?? num(text(item.size)) ?? num(enclosure?.['@_length']),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
        seeders: num(attrs.get('seeders')),
        leechers:
          num(attrs.get('peers')) !== undefined
            ? num(attrs.get('peers'))! - (num(attrs.get('seeders')) ?? 0)
            : undefined,
        infoHash: attrs.get('infohash'),
        categories: [
          ...list(item.category).map((c) => num(text(c))),
          ...[...attrs.entries()].filter(([k]) => k === 'category').map(([, v]) => num(v)),
        ].filter((c): c is number => c !== undefined),
        ids: {
          ...(imdb && { imdb: imdb.startsWith('tt') ? imdb : `tt${imdb.padStart(7, '0')}` }),
          ...(attrs.get('tmdbid') && { tmdb: attrs.get('tmdbid') }),
          ...(attrs.get('tvdbid') && { tvdb: attrs.get('tvdbid') }),
        },
        ...(flags.length && { flags }),
      } as ReleaseInfo,
    ]
  })
}
