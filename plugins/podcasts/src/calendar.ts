// Podcast episodes on the calendar, by publication date. Loaded only while the calendar
// plugin is enabled.

import { entryState } from '@magpiejs/calendar'
import type { Context } from 'cordis'
import { and, gte, lte } from 'drizzle-orm'
import type { PodcastsService } from './index'
import * as schema from './schema'

export default function podcastCalendar(ctx: Context, podcasts: PodcastsService) {
  ctx.calendar.source('podcast', (from, to, now) => {
    const rows = podcasts.db
      .select()
      .from(schema.episodes)
      .where(
        and(
          gte(schema.episodes.publishedAt, from),
          // published during the last day of the range too
          lte(schema.episodes.publishedAt, `${to}T23:59:59.999Z`),
        ),
      )
      .all()
    const shows = new Map<number, ReturnType<PodcastsService['get']>>()
    const files = new Map<number, Set<number>>()
    return rows.flatMap((episode) => {
      if (!shows.has(episode.mediaId)) {
        shows.set(episode.mediaId, podcasts.get(episode.mediaId))
        files.set(episode.mediaId, new Set(podcasts.episodeFiles(episode.mediaId).keys()))
      }
      const podcast = shows.get(episode.mediaId)
      if (!podcast) return []
      const date = episode.publishedAt!.slice(0, 10)
      return [
        {
          uid: `podcast-episode-${episode.id}`,
          date,
          kind: 'podcast' as const,
          mediaId: podcast.id,
          link: `/podcasts/${podcast.id}`,
          title: podcast.title,
          subtitle: episode.title,
          state: entryState(
            date,
            {
              hasFile: files.get(episode.mediaId)!.has(episode.id),
              monitored: podcast.monitored && episode.monitored,
            },
            now,
          ),
        },
      ]
    })
  })
  ctx.on('podcasts/episodes', () => ctx.emit('calendar/changed'))
}
