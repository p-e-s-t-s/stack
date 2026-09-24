// @magpiejs/calendar: upcoming and recent episodes (and movie releases) as a Calendar page and
// an iCal feed at /api/v1/calendar.ics (docs/phase-4.md §4.5). Uses whichever of the series and
// movies plugins are enabled.

import type {} from '@cordisjs/plugin-timer'
import type {} from '@magpiejs/api'
import { QUALITY_NAMES, type Quality } from '@magpiejs/decision/qualities'
import type {} from '@magpiejs/movies'
import type {} from '@magpiejs/series'
import type { Context } from 'cordis'
import console_ from './console'

export const name = 'calendar'

export interface CalendarEntry {
  /** Stable id for iCal, e.g. `episode-12`. */
  uid: string
  /** ISO date. */
  date: string
  kind: 'episode' | 'movie'
  /** Library item id (series or movie). */
  mediaId: number
  title: string
  /** `S01E02 · Episode title` or `Digital release`. */
  subtitle: string
  state: 'downloaded' | 'missing' | 'upcoming' | 'unmonitored'
  quality?: string
}

const DAY = 86_400_000
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const pad = (n: number) => String(n).padStart(2, '0')

/** Calendar entries between two ISO dates (inclusive), sorted by date. */
export function entries(ctx: Context, from: string, to: string, now = Date.now()): CalendarEntry[] {
  const today = isoDate(now)
  const out: CalendarEntry[] = []
  const quality = (q: string) => QUALITY_NAMES[q as Quality] ?? q

  for (const { series, episode, file } of ctx.get('series')?.airing(from, to) ?? []) {
    const monitored = series.monitored && episode.monitored
    // daily shows are known by their date, which the calendar already shows
    const number =
      series.details.seriesType === 'daily' ? '' : `S${pad(episode.season)}E${pad(episode.number)}`
    out.push({
      uid: `episode-${episode.id}`,
      date: episode.airDate!,
      kind: 'episode',
      mediaId: series.id,
      title: series.title,
      subtitle: [number, episode.title].filter(Boolean).join(' · ') || episode.airDate!,
      state: file
        ? 'downloaded'
        : !monitored
          ? 'unmonitored'
          : episode.airDate! > today
            ? 'upcoming'
            : 'missing',
      quality: file && quality(file.quality),
    })
  }

  for (const movie of ctx.get('movies')?.list() ?? []) {
    const d = movie.details
    const dates: [string | null, string][] = [
      [d.inCinemas, 'In cinemas'],
      [d.digitalRelease, 'Digital release'],
      [d.physicalRelease, 'Disc release'],
    ]
    for (const [date, label] of dates) {
      if (!date || date < from || date > to) continue
      out.push({
        uid: `movie-${movie.id}-${label.split(' ')[0]!.toLowerCase()}`,
        date,
        kind: 'movie',
        mediaId: movie.id,
        title: movie.year ? `${movie.title} (${movie.year})` : movie.title,
        subtitle: label,
        state: movie.file
          ? 'downloaded'
          : !movie.monitored
            ? 'unmonitored'
            : date > today
              ? 'upcoming'
              : 'missing',
        quality: movie.file && quality(movie.file.quality),
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}

/** Escapes text for an iCal property value. */
const ical = (text: string) => text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')

/** An iCalendar (RFC 5545) document with one all-day event per entry. */
export function toICal(list: CalendarEntry[], now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const day = (iso: string) => iso.replace(/-/g, '')
  const next = (iso: string) => day(isoDate(Date.parse(iso) + DAY))
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Magpie//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Magpie',
    ...list.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}@magpie`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(e.date)}`,
      `DTEND;VALUE=DATE:${next(e.date)}`,
      `SUMMARY:${ical(`${e.title} - ${e.subtitle}`)}`,
      `DESCRIPTION:${ical(e.quality ? `Downloaded (${e.quality})` : e.state)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}

export function apply(ctx: Context) {
  ctx.inject(['api'], (ctx) => {
    ctx.api.get('/calendar.ics', ({ query }) => {
      const now = Date.now()
      const past = Number(query.get('pastDays') ?? 14)
      const future = Number(query.get('futureDays') ?? 60)
      const body = toICal(
        entries(ctx, isoDate(now - past * DAY), isoDate(now + future * DAY), now),
        now,
      )
      return new Response(body, {
        headers: { 'content-type': 'text/calendar; charset=utf-8' },
      })
    })
    ctx.api.get('/calendar', ({ query }) => {
      const now = Date.now()
      return entries(
        ctx,
        query.get('from') ?? isoDate(now - 7 * DAY),
        query.get('to') ?? isoDate(now + 28 * DAY),
        now,
      )
    })
  })
  ctx.inject(['webui', 'timer'], (ctx) => void ctx.plugin(console_))
}
