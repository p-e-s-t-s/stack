// @magpiejs/metadata-musicbrainz: artists, their release groups ("albums" of every type) and
// track lists from MusicBrainz, covers from the Cover Art Archive. No key; MusicBrainz asks
// for at most one request per second and a descriptive User-Agent.

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/metadata'
import type {} from '@magpiejs/music'
import type {
  AlbumMetadata,
  ArtistMetadata,
  MetadataProvider,
  TrackListMetadata,
} from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'metadata-musicbrainz'
export const inject = ['http', 'metadata']

export interface Config {
  baseUrl: string
  coversUrl: string
  /** Milliseconds between requests. */
  interval: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default('https://musicbrainz.org/ws/2').hidden(),
  coversUrl: z.string().default('https://coverartarchive.org').hidden(),
  interval: z.natural().default(1100).hidden(),
})

interface Credit {
  artist: { id: string; name: string }
}

interface ReleaseGroup {
  id: string
  title: string
  'primary-type'?: string | null
  'secondary-types'?: string[]
  'first-release-date'?: string
  'artist-credit'?: Credit[]
}

interface Release {
  id: string
  status?: string
  date?: string
  country?: string
  media: {
    position: number
    format?: string | null
    'track-count': number
    tracks?: {
      position: number
      number: string
      title: string
      length?: number | null
      recording?: { id: string; length?: number | null }
    }[]
  }[]
}

interface Artist {
  id: string
  name: string
  'sort-name'?: string
  type?: string
  disambiguation?: string
  country?: string
  aliases?: { name: string }[]
  'life-span'?: { begin?: string }
}

const FORMAT_PREFERENCE = ['Digital Media', 'CD']

/**
 * The release whose track list stands for the album: official, with the most common track
 * count (the standard edition, not a deluxe one), digital or CD, earliest first.
 */
export function pickRelease(releases: Release[]): Release | undefined {
  const official = releases.filter((r) => r.status === 'Official' && r.media.length)
  const pool = official.length ? official : releases.filter((r) => r.media.length)
  const tracks = (r: Release) => r.media.reduce((n, m) => n + m['track-count'], 0)
  const counts = new Map<number, number>()
  for (const r of pool) counts.set(tracks(r), (counts.get(tracks(r)) ?? 0) + 1)
  const common = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0]
  const format = (r: Release) => {
    const i = FORMAT_PREFERENCE.indexOf(r.media[0]?.format ?? '')
    return i < 0 ? FORMAT_PREFERENCE.length : i
  }
  return pool
    .filter((r) => tracks(r) === common)
    .sort((a, b) => format(a) - format(b) || (a.date || '9999').localeCompare(b.date || '9999'))[0]
}

export function apply(ctx: Context, config: Config) {
  // one request at a time, `interval` apart; retried while MusicBrainz is busy
  let queue = Promise.resolve()
  let last = 0
  async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = last + config.interval - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        last = Date.now()
        const response = await ctx.http(`${config.baseUrl}${path}`, {
          params: { ...params, fmt: 'json' },
          headers: { 'User-Agent': 'Magpie/0.0 ( https://github.com/p-e-s-t-s/stack )' },
          timeout: 30_000,
          validateStatus: () => true,
        } as never)
        if ((response.status === 503 || response.status === 429) && attempt < 4) {
          await new Promise((r) => setTimeout(r, config.interval * 2 ** (attempt + 1)))
          continue
        }
        if (response.status >= 400) throw new Error(`MusicBrainz answered HTTP ${response.status}`)
        return (await response.json()) as T
      }
    }
    const result = queue.then(run)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  const cover = (releaseGroupId: string) =>
    `${config.coversUrl}/release-group/${releaseGroupId}/front-250`

  const artistOf = (a: Artist): ArtistMetadata => ({
    kind: 'music',
    title: a.name,
    ids: { musicbrainz: a.id },
    artistType: a.type,
    disambiguation: a.disambiguation || undefined,
    sortName: a['sort-name'],
    country: a.country,
    overview: [
      a.type,
      a.country,
      a.disambiguation,
      a['life-span']?.begin && `since ${a['life-span'].begin.slice(0, 4)}`,
    ]
      .filter(Boolean)
      .join(' · '),
    alternateNames: [...new Set((a.aliases ?? []).map((x) => x.name))].filter((n) => n !== a.name),
  })

  const provider: MetadataProvider = {
    id: 'musicbrainz',
    kinds: ['music'],

    async search(query) {
      const { artists } = await get<{ artists: (Artist & { score: number })[] }>('/artist', {
        query: query.term,
        limit: 15,
      })
      return artists.filter((a) => a.score >= 50).map(artistOf)
    },

    async getArtist(id) {
      return artistOf(await get<Artist>(`/artist/${id}`, { inc: 'aliases' }))
    },

    async getAlbums(artistId) {
      const albums: AlbumMetadata[] = []
      for (let offset = 0; ; offset += 100) {
        const page = await get<{ 'release-groups': ReleaseGroup[]; 'release-group-count': number }>(
          '/release-group',
          { artist: artistId, inc: 'artist-credits', limit: 100, offset },
        )
        for (const g of page['release-groups']) {
          // only groups the artist is credited on first (not guest spots or splits led by others)
          if (g['artist-credit']?.[0] && g['artist-credit'][0].artist.id !== artistId) continue
          albums.push({
            ids: { musicbrainz: g.id },
            title: g.title,
            primaryType: g['primary-type'] ?? undefined,
            secondaryTypes: g['secondary-types'] ?? [],
            releaseDate: g['first-release-date'] || undefined,
            coverUrl: cover(g.id),
          })
        }
        if (offset + 100 >= page['release-group-count'] || !page['release-groups'].length) break
      }
      return albums
    },

    async getTracks(albumId) {
      const { releases } = await get<{ releases: Release[] }>('/release', {
        'release-group': albumId,
        inc: 'recordings media',
        limit: 100,
      })
      const release = pickRelease(releases)
      if (!release) throw new Error('MusicBrainz has no releases for this album')
      return {
        releaseId: release.id,
        discs: release.media.map((m) => ({
          number: m.position,
          format: m.format ?? undefined,
          tracks: (m.tracks ?? []).map((t) => ({
            number: t.position,
            title: t.title,
            lengthMs: t.length ?? t.recording?.length ?? undefined,
            recordingId: t.recording?.id,
          })),
        })),
      } satisfies TrackListMetadata
    },
  }
  ctx.metadata.register(provider)
}
