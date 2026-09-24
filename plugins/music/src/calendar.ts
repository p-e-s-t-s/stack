// Album releases on the calendar, for monitored artists. Loaded only while the calendar plugin
// is enabled. Albums with only a year or month aren't shown.

import { entryState } from '@magpiejs/calendar'
import type { Context } from 'cordis'
import { and, gte, lte } from 'drizzle-orm'
import type { MusicService } from './index'
import * as schema from './schema'

export default function albumCalendar(ctx: Context, music: MusicService) {
  ctx.calendar.source('music', (from, to, now) => {
    const rows = music.db
      .select()
      .from(schema.albums)
      .where(and(gte(schema.albums.releaseDate, from), lte(schema.albums.releaseDate, to)))
      .all()
      .filter((a) => a.releaseDate!.length === 10)
    const artists = new Map<number, ReturnType<MusicService['get']>>()
    return rows.flatMap((album) => {
      if (!artists.has(album.mediaId)) artists.set(album.mediaId, music.get(album.mediaId))
      const artist = artists.get(album.mediaId)
      if (!artist) return []
      return [
        {
          uid: `album-${album.id}`,
          date: album.releaseDate!,
          kind: 'music' as const,
          mediaId: artist.id,
          link: `/music/${artist.id}/${album.id}`,
          title: artist.title,
          subtitle: `${album.title} · ${album.primaryType ?? 'Album'}`,
          state: entryState(
            album.releaseDate!,
            { hasFile: music.isComplete(album.id), monitored: artist.monitored && album.monitored },
            now,
          ),
        },
      ]
    })
  })
  ctx.on('music/changed', () => ctx.emit('calendar/changed'))
}
