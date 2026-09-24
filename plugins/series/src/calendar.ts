// Episodes on the calendar. Loaded only while the calendar plugin is enabled.

import { entryState } from '@magpiejs/calendar'
import type {} from '@magpiejs/decision'
import type { Context } from 'cordis'
import type { SeriesService } from './index'

const pad = (n: number) => String(n).padStart(2, '0')

export default function seriesCalendar(ctx: Context, series: SeriesService) {
  ctx.calendar.source('series', (from, to, now) =>
    series.airing(from, to).map(({ series: show, episode, file }) => {
      // daily shows are known by their date, which the calendar already shows
      const number =
        show.details.seriesType === 'daily' ? '' : `S${pad(episode.season)}E${pad(episode.number)}`
      return {
        uid: `episode-${episode.id}`,
        date: episode.airDate!,
        kind: 'series',
        mediaId: show.id,
        link: `/series/${show.id}`,
        title: show.title,
        subtitle: [number, episode.title].filter(Boolean).join(' · ') || episode.airDate!,
        state: entryState(
          episode.airDate!,
          { hasFile: !!file, monitored: show.monitored && episode.monitored },
          now,
        ),
        quality: file && ctx.decision.qualityName(file.quality),
      }
    }),
  )
  ctx.on('series/episodes', () => ctx.emit('calendar/changed'))
}
