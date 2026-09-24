// Album searching. Loaded only while an indexers plugin is enabled: builds queries for the
// wanted albums, matches results to the artist's albums, and runs them through the decision
// engine with the album's length for size limits.

import { compareDecisions, type Decision, type DecisionTarget } from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import type { ReleaseInfo, ReleaseQuery } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { Artist, MusicService } from './index'
import { matchAlbums } from './match'
import { parseMusic } from './parse'
import type { Album } from './schema'

export type FoundRelease = ReleaseInfo & {
  indexerName: string
  indexerPriority: number
}

export interface AlbumResult {
  release: FoundRelease
  decision: Decision
  /** The album this release is (empty when it isn't one of the artist's). */
  albumIds: number[]
}

export interface AlbumSearch {
  search(
    mediaId: number,
    albumIds: number[],
    kind?: 'automatic' | 'interactive',
  ): Promise<{ results: AlbumResult[]; errors: { indexer: string; message: string }[] }>
  cached(mediaId: number, guid: string): AlbumResult | undefined
  /** Matches and evaluates releases for an artist, best first (used by search and RSS). */
  evaluate(mediaId: number, releases: FoundRelease[], wantedIds: Set<number>): AlbumResult[]
}

/** Per-album queries for a few albums; one query for the artist when many are wanted. */
const PER_ALBUM = 10

/** The names a release may credit an artist by. */
export const artistNames = (ctx: Context, artist: Artist) => [
  artist.title,
  ...ctx.library.alternateTitlesOf(artist.id),
]

export default function albumSearch(ctx: Context, music: MusicService) {
  const cache = new Map<number, { at: number; results: Map<string, AlbumResult> }>()

  function queries(artist: Artist, wanted: Album[]): ReleaseQuery[] {
    if (wanted.length > PER_ALBUM)
      return [{ kind: 'music', term: artist.title, fields: { artist: artist.title } }]
    return wanted.map((a) => ({
      kind: 'music',
      term: `${artist.title} ${a.title}`,
      fields: { artist: artist.title, album: a.title },
    }))
  }

  function targetFor(artist: Artist, album: Album | undefined): DecisionTarget {
    const tracks = album ? music.tracks(album.id) : []
    const lengthMs = tracks.reduce((n, t) => n + (t.lengthMs ?? 0), 0)
    const worst =
      album && music.isComplete(album.id) ? music.worstFile(album.id, artist.profileId) : undefined
    return {
      kind: 'album',
      mediaId: artist.id,
      profileId: artist.profileId,
      runtimeMinutes: lengthMs ? Math.round(lengthMs / 60_000) : undefined,
      unitIds: album ? [album.id] : [],
      current: worst && {
        quality: worst.quality as never,
        formatScore: worst.formatScore,
        revision: worst.revision,
      },
    }
  }

  const api: AlbumSearch = {
    async search(mediaId, albumIds, kind = 'automatic') {
      const artist = music.get(mediaId)
      if (!artist) throw new Error(`artist ${mediaId} not found`)
      const wanted = music.albums(mediaId).filter((a) => albumIds.includes(a.id))
      if (!wanted.length) return { results: [], errors: [] }
      // album lengths set the size limits
      for (const a of wanted) {
        try {
          await music.ensureTracks(a.id)
        } catch (error) {
          ctx.logger.warn('no track list for %s: %s', a.title, error)
        }
      }
      const releases: FoundRelease[] = []
      const errors: { indexer: string; message: string }[] = []
      for (const query of queries(artist, wanted)) {
        const outcome = await ctx.indexers.search(query, kind)
        releases.push(...(outcome.releases as FoundRelease[]))
        errors.push(...outcome.errors)
      }
      const wantedIds = new Set(wanted.map((a) => a.id))
      const results = api.evaluate(mediaId, releases, wantedIds)
      cache.set(mediaId, {
        at: Date.now(),
        results: new Map(results.map((r) => [r.release.guid, r])),
      })
      music.markSearched([...wantedIds])
      return { results, errors }
    },

    evaluate(mediaId, releases, wantedIds) {
      const artist = music.get(mediaId)
      if (!artist) return []
      const albums = music.albums(mediaId)
      const names = artistNames(ctx, artist)
      const seen = new Set<string>()
      const results: AlbumResult[] = []
      for (const release of releases) {
        if (seen.has(release.guid)) continue
        seen.add(release.guid)
        const parsed = parseMusic(release.title)
        // wanted albums first, so a release matching two titles goes to the wanted one
        const [album] = matchAlbums(parsed, names, albums).sort(
          (a, b) => Number(wantedIds.has(b.id)) - Number(wantedIds.has(a.id)),
        )
        const decision = ctx.decision.evaluate({ info: release, parsed }, targetFor(artist, album))
        const reject = (rule: string, reason: string) => {
          decision.rejections.unshift({ rule, reason, permanent: true })
          decision.accepted = false
        }
        if (!album) reject('album-match', `is not an album by ${artist.title}`)
        else if (!wantedIds.has(album.id))
          reject('album-match', `is ${album.title}, which isn't wanted`)
        decision.rank.push(-release.indexerPriority)
        results.push({ release, decision, albumIds: album ? [album.id] : [] })
      }
      return results.sort(
        (a, b) =>
          Number(b.decision.accepted) - Number(a.decision.accepted) ||
          compareDecisions(a.decision, b.decision),
      )
    },

    cached(mediaId, guid) {
      const entry = cache.get(mediaId)
      if (!entry || Date.now() - entry.at > 60 * 60_000) return
      return entry.results.get(guid)
    },
  }

  ctx.indexers.searchType('music', {
    mode: 'music',
    fields: ['artist', 'album'],
    defaultCategories: [3000, 3010, 3040],
  })

  ctx.effect(() => {
    music.searcher = api
    return () => (music.searcher = undefined)
  }, 'music.searcher')
}
