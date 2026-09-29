import Database from '@magpiejs/database'
import Decision from '@magpiejs/decision'
import Library from '@magpiejs/library'
import Metadata from '@magpiejs/metadata'
import { Context } from 'cordis'
import { expect, it, vi } from 'vitest'
import Browse from '../src'

it('gates feeds and requests by live kind/provider registrations and caches remote results', async () => {
  const ctx = new Context()
  await ctx.plugin(Database, { path: ':memory:' })
  await ctx.plugin(Decision)
  await ctx.plugin(Library)
  await ctx.plugin(Metadata)
  await ctx.plugin(Browse)
  const discover = vi.fn(async () => [
    { kind: 'movie' as const, title: 'Example', ids: { tmdb: '10' } },
  ])
  let removeProvider!: () => void
  const provider = ctx.inject(['metadata'], (scope) => {
    removeProvider = scope.metadata.register({
      id: 'test',
      kinds: ['movie', 'series'],
      search: async () => [],
      discover,
      discoveryFeeds: [
        { id: 'movies', kind: 'movie', label: 'Movies' },
        { id: 'tv', kind: 'series', label: 'TV' },
      ],
    })
  })
  await provider
  expect(ctx.browse.feeds()).toEqual([])
  await expect(ctx.browse.load('test', 'movies', 'US')).rejects.toThrow('no longer enabled')
  let removeKind!: () => void
  await ctx.inject(['library'], (scope) => {
    removeKind = scope.library.registerKind({
      id: 'movie',
      label: 'Movies',
      browse: { addPath: '/movies/add', detailPath: '/movie' },
    })
  })
  expect(ctx.browse.feeds().map((f) => f.id)).toEqual(['movies'])
  expect((await ctx.browse.load('test', 'movies', 'US'))[0]).toMatchObject({
    inLibrary: false,
    link: '/movies/add?q=Example',
  })
  await ctx.browse.load('test', 'movies', 'US')
  expect(discover).toHaveBeenCalledTimes(1)
  await ctx.browse.load('test', 'movies', 'GB')
  expect(discover).toHaveBeenCalledTimes(2)
  await expect(ctx.browse.load('test', 'movies', 'bad')).rejects.toThrow('country code')
  let finish!: (items: { kind: 'movie'; title: string; ids: { tmdb: string } }[]) => void
  discover.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = ctx.browse.load('test', 'movies', 'CA')
  removeKind()
  finish([{ kind: 'movie', title: 'Late response', ids: { tmdb: '20' } }])
  expect(await pending).toEqual([])
  expect(ctx.browse.feeds()).toEqual([])
  await expect(ctx.browse.load('test', 'movies', 'US')).rejects.toThrow('no longer enabled')
  removeProvider()
  expect(ctx.metadata.discovery()).toEqual([])
})
