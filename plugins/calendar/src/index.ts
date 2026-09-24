// @magpiejs/calendar: a Calendar page and an iCal feed at /api/v1/calendar.ics
// (docs/phase-4.md §4.5). Kinds of media add their dates with `ctx.calendar.source()`:
// episodes from series, releases from movies, and later albums, books and podcast episodes.

import type {} from '@cordisjs/plugin-timer'
import type {} from '@magpiejs/api'
import type { MediaKind } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import console_ from './console'

declare module 'cordis' {
  interface Context {
    calendar: CalendarService
  }
  interface Events {
    'calendar/sources'(): void
    /** A source's dates or states changed (e.g. new episodes); open calendars reload. */
    'calendar/changed'(): void
  }
}

export interface CalendarEntry {
  /** Stable id for iCal, e.g. `episode-12`. */
  uid: string
  /** ISO date. */
  date: string
  kind: MediaKind
  /** Library item id. */
  mediaId: number
  /** Web console path the entry opens, e.g. `/series/3`. */
  link: string
  title: string
  /** `S01E02 · Episode title` or `Digital release`. */
  subtitle: string
  state: 'downloaded' | 'missing' | 'upcoming' | 'unmonitored'
  quality?: string
}

/** Entries of one kind between two ISO dates (inclusive). */
export type CalendarSource = (from: string, to: string, now: number) => CalendarEntry[]

const DAY = 86_400_000
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The usual state of a dated entry: has a file, not monitored, still to come, or missing. */
export function entryState(
  date: string,
  options: { hasFile: boolean; monitored: boolean },
  now = Date.now(),
): CalendarEntry['state'] {
  if (options.hasFile) return 'downloaded'
  if (!options.monitored) return 'unmonitored'
  return date > isoDate(now) ? 'upcoming' : 'missing'
}

export class CalendarService extends Service {
  private sources = new Map<MediaKind, CalendarSource>()

  constructor(ctx: Context) {
    super(ctx, 'calendar')
  }

  [Service.init]() {
    this.ctx.inject(['api'], (ctx) => {
      ctx.api.get('/calendar.ics', ({ query }) => {
        const now = Date.now()
        const past = Number(query.get('pastDays') ?? 14)
        const future = Number(query.get('futureDays') ?? 60)
        const body = toICal(
          this.entries(isoDate(now - past * DAY), isoDate(now + future * DAY), now),
          now,
        )
        return new Response(body, {
          headers: { 'content-type': 'text/calendar; charset=utf-8' },
        })
      })
      ctx.api.get('/calendar', ({ query }) => {
        const now = Date.now()
        return this.entries(
          query.get('from') ?? isoDate(now - 7 * DAY),
          query.get('to') ?? isoDate(now + 28 * DAY),
          now,
        )
      })
    })
    this.ctx.inject(['webui', 'timer'], (ctx) => void ctx.plugin(console_, this))
  }

  /** Adds a kind's dates to the calendar, for the caller's lifetime. */
  source(kind: MediaKind, source: CalendarSource) {
    return this.ctx.effect(() => {
      this.sources.set(kind, source)
      this.ctx.emit('calendar/sources')
      return () => {
        this.sources.delete(kind)
        this.ctx.emit('calendar/sources')
      }
    }, `calendar.source(${kind})`)
  }

  /** Entries of every kind between two ISO dates (inclusive), sorted by date. */
  entries(from: string, to: string, now = Date.now()): CalendarEntry[] {
    return [...this.sources.values()]
      .flatMap((source) => source(from, to, now))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
  }
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

export default CalendarService
