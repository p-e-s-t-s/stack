// Album searching. Loaded only while an indexers plugin is enabled: builds queries for the
// wanted albums and matches results to the artist's albums, with the album's length for size
// limits (the searching, evaluating and caching itself is @magpiejs/units').

import type { DecisionTarget } from '@magpiejs/decision'
import type {} from '@magpiejs/indexers'
import type { ReleaseQuery } from '@magpiejs/types'
import { unitSearch } from '@magpiejs/units'
import type { Context } from 'cordis'
import type { Artist, MusicService } from './index'
import { matchAlbums } from './match'
import { type ParsedMusic, parseMusic } from './parse'
import type { Album } from './schema'

export type {
  FoundRelease,
  UnitResult as AlbumResult,
  UnitSearch as AlbumSearch,
} from '@magpiejs/units'

/** Per-album queries for a few albums; one query for the artist when many are wanted. */
const PER_ALBUM = 10

/** The names a release may credit an artist by. */
export const artistNames = (ctx: Context, artist: Artist) => [
  artist.title,
  ...ctx.library.alternateTitlesOf(artist.id),
]

export default function albumSearch(ctx: Context, music: MusicService) {
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

  const api = unitSearch<Artist, Album>(ctx, {
    item: (id) => music.get(id),
    units: (id) => music.albums(id),
    queries,
    // album lengths set the size limits
    async prepare(_, wanted) {
      for (const a of wanted) {
        try {
          await music.ensureTracks(a.id)
        } catch (error) {
          ctx.logger.warn('no track list for %s: %s', a.title, error)
        }
      }
    },
    parse: parseMusic,
    matcher(artist, albums, wanted) {
      const names = artistNames(ctx, artist)
      return (parsed) => {
        // wanted albums first, so a release matching two titles goes to the wanted one
        const [album] = matchAlbums(parsed as ParsedMusic, names, albums).sort(
          (a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)),
        )
        if (!album)
          return { reject: { rule: 'album-match', reason: `is not an album by ${artist.title}` } }
        if (!wanted.has(album.id))
          return {
            reject: { rule: 'album-match', reason: `is ${album.title}, which isn't wanted` },
          }
        return { units: [album] }
      }
    },
    target: (artist, _, covered) => targetFor(artist, covered[0]),
    markSearched: (_, ids) => music.markSearched(ids),
  })

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
