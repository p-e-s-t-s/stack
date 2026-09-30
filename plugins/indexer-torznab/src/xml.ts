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

/** A parsed XML element: child elements and `@_`-prefixed attributes. */
type XmlNode = Record<string, unknown>
const nodes = (value: unknown) => list(value as XmlNode | XmlNode[] | undefined)
const attr = (node: XmlNode | undefined, name: string) => node?.[`@_${name}`]

export class TorznabError extends Error {}

function checkError(doc: XmlNode) {
  const error = doc.error as XmlNode | undefined
  if (error)
    throw new TorznabError(
      `${attr(error, 'description') ?? 'indexer error'} (code ${attr(error, 'code') ?? '?'})`,
    )
}

/** Capabilities: categories, and the parameters of each search mode it offers. */
export function parseCaps(xml: string): IndexerCaps {
  const doc = parser.parse(xml)
  checkError(doc)
  const caps = (doc.caps ?? {}) as XmlNode
  const searching = (caps.searching ?? {}) as XmlNode
  const params = (node: unknown) => {
    const search = node as XmlNode | undefined
    return attr(search, 'available') === 'yes'
      ? String(attr(search, 'supportedParams') ?? 'q')
          .split(',')
          .map((p) => p.trim())
      : []
  }
  const categories = nodes((caps.categories as XmlNode | undefined)?.category).flatMap((c) => [
    { id: Number(attr(c, 'id')), name: String(attr(c, 'name')) },
    ...nodes(c.subcat).map((s) => ({
      id: Number(attr(s, 'id')),
      name: `${attr(c, 'name')}/${attr(s, 'name')}`,
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
  const channel = (doc.rss as XmlNode | undefined)?.channel as XmlNode | undefined
  return nodes(channel?.item).flatMap((item): ReleaseInfo[] => {
    const attrs = new Map<string, string>()
    for (const a of [...nodes(item['torznab:attr']), ...nodes(item['newznab:attr'])]) {
      attrs.set(String(attr(a, 'name')).toLowerCase(), String(attr(a, 'value')))
    }
    const title = text(item.title)
    const enclosure = nodes(item.enclosure)[0]
    const downloadUrl = text(attr(enclosure, 'url')) ?? text(item.link) ?? attrs.get('magneturl')
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
        size:
          num(attrs.get('size')) ?? num(text(item.size)) ?? num(text(attr(enclosure, 'length'))),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
        seeders: num(attrs.get('seeders')),
        leechers:
          num(attrs.get('peers')) !== undefined
            ? num(attrs.get('peers'))! - (num(attrs.get('seeders')) ?? 0)
            : undefined,
        infoHash: attrs.get('infohash'),
        categories: [
          ...list<unknown>(item.category).map((c) => num(text(c))),
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
