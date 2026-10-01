import { createTestContext } from '@magpiejs/testing'
import { expect, it } from 'vitest'
import SearchService from '../src'

it('finds titles by name, prefix matches first, only for kinds that have a page', async () => {
  const ctx = await createTestContext({ metadata: false, calendar: false })
  await ctx.plugin(SearchService)
  ctx.library.registerKind({
    id: 'movie',
    label: 'Movies',
    browse: { addPath: '/movies/add', detailPath: '/movie' },
  })
  const profileId = ctx.decision.profiles()[0]!.id
  const rootFolderId = ctx.library.addRootFolder('/movies', 'movie').id
  const add = (title: string, kind: 'movie' | 'series' = 'movie') =>
    ctx.library.add({
      kind,
      title,
      year: 2020,
      externalIds: {},
      primaryProvider: 'test',
      profileId,
      rootFolderId,
      folder: title,
    })
  add('The Dark Knight')
  const dark = add('Dark City')
  add('Unrelated')
  add('Dark Matter', 'series') // no registered series kind: no page to open

  const hits = ctx.search.find('dark')
  expect(hits.map((h) => h.title)).toEqual(['Dark City', 'The Dark Knight'])
  expect(hits[0]).toMatchObject({ id: dark.id, kindLabel: 'Movies', path: `/movie/${dark.id}` })
  expect(ctx.search.find('  ')).toEqual([])
  expect(ctx.search.find('100%')).toEqual([])
})
