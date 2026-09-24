import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import SeriesService from '@magpiejs/series'
import { Context } from 'cordis'
import { expect, it } from 'vitest'
import CalendarService, { isoDate, toICal } from '../src'

it('lists episodes by air date with their state, and as iCal', async () => {
  const DAY = 86_400_000
  const now = Date.now()
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(MetadataService)
  await ctx.plugin(SeriesService)
  await ctx.plugin(CalendarService)
  ctx.metadata.register({
    id: 'tmdb',
    kinds: ['series'],
    search: async () => [],
    getSeries: async () => ({
      kind: 'series',
      title: 'Show, The',
      ids: { tmdb: '1' },
      seasons: [{ number: 1, episodeCount: 3 }],
    }),
    getEpisodes: async () => [
      { season: 1, number: 1, title: 'Old', airDate: isoDate(now - 90 * DAY) },
      { season: 1, number: 2, title: 'Last week', airDate: isoDate(now - 3 * DAY) },
      { season: 1, number: 3, title: 'Next week', airDate: isoDate(now + 4 * DAY) },
    ],
  })
  await ctx.series.add({
    tmdbId: 1,
    profileId: ctx.decision.profiles()[0]!.id,
    rootFolderId: ctx.library.addRootFolder('/tv', 'series').id,
    search: false,
  })

  const list = ctx.calendar.entries(isoDate(now - 7 * DAY), isoDate(now + 7 * DAY), now)
  expect(list.map((e) => [e.subtitle, e.state])).toEqual([
    ['S01E02 · Last week', 'missing'],
    ['S01E03 · Next week', 'upcoming'],
  ])

  const ics = toICal(list, now)
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  expect(ics).toContain('SUMMARY:Show\\, The - S01E03 · Next week')
  expect(ics).toContain(`DTSTART;VALUE=DATE:${isoDate(now + 4 * DAY).replace(/-/g, '')}`)
})
