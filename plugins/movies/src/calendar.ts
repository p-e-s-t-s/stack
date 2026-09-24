// Movie release dates on the calendar. Loaded only while the calendar plugin is enabled.

import { entryState } from '@magpiejs/calendar'
import type {} from '@magpiejs/decision'
import type { Context } from 'cordis'
import type { MoviesService } from './index'

export default function movieCalendar(ctx: Context, movies: MoviesService) {
  ctx.calendar.source('movie', (from, to, now) =>
    movies.list().flatMap((movie) => {
      const d = movie.details
      const dates: [string | null, string, string][] = [
        [d.inCinemas, 'In cinemas', 'cinemas'],
        [d.digitalRelease, 'Digital release', 'digital'],
        [d.physicalRelease, 'Disc release', 'disc'],
      ]
      return dates
        .filter(([date]) => date && date >= from && date <= to)
        .map(([date, label, key]) => ({
          uid: `movie-${movie.id}-${key}`,
          date: date!,
          kind: 'movie',
          mediaId: movie.id,
          link: `/movie/${movie.id}`,
          title: movie.year ? `${movie.title} (${movie.year})` : movie.title,
          subtitle: label,
          state: entryState(date!, { hasFile: !!movie.file, monitored: movie.monitored }, now),
          quality: movie.file && ctx.decision.qualityName(movie.file.quality),
        }))
    }),
  )
}
