// Automatic searching and grabbing for music: on add, after a failed download, a daily sweep of
// wanted albums, and RSS — with @magpiejs/units. Active while both an indexers and a downloads
// plugin are loaded.

import type {} from '@magpiejs/downloads'
import type {} from '@magpiejs/indexers'
import { unitAutomation } from '@magpiejs/units'
import type { Context } from 'cordis'
import type { MusicService } from './index'
import { matchAlbums } from './match'
import { parseMusic } from './parse'
import { artistNames } from './search'

export default function automation(ctx: Context, music: MusicService) {
  const { enqueue } = unitAutomation(ctx, {
    name: 'music',
    item: (id) => music.get(id),
    items: () => music.list(),
    wanted: (id, now) => music.wantedAlbums(id, now),
    searcher: () => music.searcher,
    searchAndGrab: (id, ids) => music.searchAndGrab(id, ids),
    grab: (id, result) => music.grabber!(id, result, false),
    // releases that are an album of an artist in the library
    rssItems(release) {
      const parsed = parseMusic(release.title)
      if (!parsed.codec) return []
      return music
        .list()
        .filter((a) => a.monitored)
        .filter((a) => matchAlbums(parsed, artistNames(ctx, a), music.albums(a.id)).length)
        .map((a) => a.id)
    },
    // album lengths set the size limits
    async prepareRss(_, wanted) {
      for (const id of wanted) await music.ensureTracks(id).catch(() => {})
    },
  })

  ctx.on('music/added', (artist, options) => {
    if (options.search) enqueue(artist.id)
  })
}
