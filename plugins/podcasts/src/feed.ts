// Podcast feeds: RSS 2.0 with the iTunes (`itunes:`) and Podcasting 2.0 (`podcast:`)
// namespaces, which is what nearly every podcast publishes.

import { XMLParser } from 'fast-xml-parser'

export interface FeedEpisode {
  guid: string
  title: string
  description?: string
  /** ISO date-time. */
  publishedAt?: string
  enclosure: { url: string; type?: string; length?: number }
  durationSeconds?: number
  season?: number
  number?: number
  imageUrl?: string
}

export interface Feed {
  title: string
  author?: string
  description?: string
  link?: string
  language?: string
  imageUrl?: string
  episodes: FeedEpisode[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // keep text as text: guids and titles that look like numbers stay as written
  parseTagValue: false,
  trimValues: true,
})

const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** The text of an element that may have attributes (`<guid isPermaLink="false">…</guid>`). */
function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined
  if (typeof node === 'object') return text((node as Record<string, unknown>)['#text'])
  const value = String(node).trim()
  return value || undefined
}

/** `1:02:03`, `62:03` or `3723` seconds. */
export function parseDuration(value: string | undefined) {
  if (!value) return undefined
  const parts = value.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return undefined
  return parts.reduce((total, n) => total * 60 + n, 0) || undefined
}

function isoDate(value: string | undefined) {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

const int = (value: string | undefined) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml)
  const channel = doc?.rss?.channel
  if (!channel) throw new Error('not a podcast feed (no RSS channel)')
  const image = channel['itunes:image']?.['@_href'] ?? text(channel.image?.url) ?? undefined

  const episodes: FeedEpisode[] = []
  for (const item of list<any>(channel.item)) {
    const enclosure = list<any>(item.enclosure)[0]
    const url = enclosure?.['@_url']
    // items without media (announcements, trailers without files) can't be downloaded
    if (!url) continue
    episodes.push({
      guid: text(item.guid) ?? url,
      title: text(item.title) ?? text(item['itunes:title']) ?? 'Untitled',
      description: text(item['itunes:summary']) ?? text(item.description),
      publishedAt: isoDate(text(item.pubDate)),
      enclosure: {
        url,
        type: enclosure['@_type'],
        length: int(enclosure['@_length']),
      },
      durationSeconds: parseDuration(text(item['itunes:duration'])),
      season: int(text(item['itunes:season']) ?? text(item['podcast:season'])),
      number: int(text(item['itunes:episode']) ?? text(item['podcast:episode'])),
      imageUrl: item['itunes:image']?.['@_href'],
    })
  }
  return {
    title: text(channel.title) ?? 'Untitled podcast',
    author: text(channel['itunes:author']) ?? text(channel['itunes:owner']?.['itunes:name']),
    description: text(channel['itunes:summary']) ?? text(channel.description),
    link: text(channel.link),
    language: text(channel.language),
    imageUrl: image,
    episodes,
  }
}
