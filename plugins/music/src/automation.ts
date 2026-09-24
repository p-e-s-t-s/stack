// Automatic searching and grabbing for music: on add, after a failed download, a daily sweep of
// wanted albums, and RSS. Active while both an indexers and a downloads plugin are loaded.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import type { Context } from 'cordis'
import { type MusicService, pickReleases } from './index'
import { matchAlbums } from './match'
import { parseMusic } from './parse'
import { artistNames, type FoundRelease } from './search'

const DAY = 86_400_000

export default function automation(ctx: Context, music: MusicService, config = { sweepBatch: 20 }) {
  const enqueue = (mediaId: number, albumIds?: number[]) =>
    ctx.jobs.enqueue(
      'music.search',
      { mediaId, albumIds },
      { dedupeKey: `music.search:${mediaId}:${albumIds?.join(',') ?? 'wanted'}` },
    )

  ctx.jobs.define(
    'music.search',
    async ({ mediaId, albumIds }: { mediaId: number; albumIds?: number[] }) => {
      const artist = music.get(mediaId)
      if (!artist?.monitored) return
      // only albums that are still wanted (files may have arrived meanwhile)
      const wanted = new Set(music.wantedAlbums(mediaId).map((a) => a.id))
      const ids = (albumIds ?? [...wanted]).filter((id) => wanted.has(id))
      if (!ids.length) return
      const grabbed = await music.searchAndGrab(mediaId, ids)
      if (!grabbed.length) ctx.logger.info('no acceptable release found for %s', artist.title)
    },
    { maxAttempts: 3, retryDelayMs: 5 * 60_000 },
  )

  ctx.on('music/added', (artist, options) => {
    if (options.search) enqueue(artist.id)
  })

  // a failed download is blocklisted by the downloads plugin; look for the next best release
  ctx.on('downloads/failed', (grab) => {
    if (music.get(grab.mediaId)) enqueue(grab.mediaId, music.grabAlbums(grab.id))
  })

  // daily: artists with wanted albums that weren't searched in the last day, oldest first
  ctx.jobs.define('music.wanted', () => {
    const now = Date.now()
    const due = music
      .list()
      .filter((a) => a.monitored)
      .map((artist) => {
        const wanted = music.wantedAlbums(artist.id, now)
        const last = Math.min(...wanted.map((a) => a.lastSearchedAt ?? 0))
        return { artist, wanted, last }
      })
      .filter(({ wanted, last }) => wanted.length && now - last > DAY)
      .sort((a, b) => a.last - b.last)
      .slice(0, config.sweepBatch)
    for (const { artist } of due) enqueue(artist.id)
  })
  ctx.jobs.schedule('music.wanted', 'music.wanted', DAY)

  // RSS: releases that are a wanted album of an artist in the library
  ctx.on('indexers/rss', async (releases) => {
    const artists = music.list().filter((a) => a.monitored)
    if (!artists.length || !music.searcher || !music.grabber) return
    const byArtist = new Map<number, FoundRelease[]>()
    for (const release of releases as FoundRelease[]) {
      const parsed = parseMusic(release.title)
      if (!parsed.codec) continue
      for (const artist of artists)
        if (matchAlbums(parsed, artistNames(ctx, artist), music.albums(artist.id)).length)
          byArtist.set(artist.id, [...(byArtist.get(artist.id) ?? []), release])
    }
    for (const [mediaId, candidates] of byArtist) {
      const wanted = new Set(music.wantedAlbums(mediaId).map((a) => a.id))
      if (!wanted.size) continue
      for (const id of wanted) await music.ensureTracks(id).catch(() => {})
      for (const result of pickReleases(
        music.searcher.evaluate(mediaId, candidates, wanted),
        wanted,
      )) {
        try {
          await music.grabber(mediaId, result, false)
        } catch (error) {
          ctx.logger.warn('could not grab %s from RSS: %s', result.release.title, error)
        }
      }
    }
  })
}
