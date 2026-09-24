// Web console entry: the Calendar page.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import { type CalendarEntry, entries, isoDate } from './index'

export interface CalendarData {
  /** Entries between two ISO dates. */
  range(from: string, to: string): Promise<CalendarEntry[]>
  /** Bumped when episodes, movies or files change, so the page reloads. */
  revision: number
}

export default function console_(ctx: Context) {
  const bump = ctx.debounce(() => entry.mutate((d) => (d.revision += 1)), 500)
  for (const event of [
    'series/episodes',
    'library/added',
    'library/updated',
    'library/deleted',
    'library/file-added',
    'library/file-removed',
  ] as const)
    ctx.on(event, bump)

  const data: CalendarData = {
    revision: 0,
    async range(from, to) {
      // at most a year at a time
      if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000)
        to = isoDate(Date.parse(from) + 366 * 86_400_000)
      return entries(ctx, from, to)
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/calendar'],
    },
    data,
  )
}
