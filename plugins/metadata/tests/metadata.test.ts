import type { MetadataProvider } from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, expect, it } from 'vitest'
import MetadataService from '../src'

const provider = (id: string, kinds: MetadataProvider['kinds']): MetadataProvider => ({
  id,
  kinds,
  search: async () => [],
})

let ctx: Context
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(MetadataService)
})

it('picks a provider by kind, preferring the requested id', () => {
  ctx.metadata.register(provider('a', ['movie']))
  ctx.metadata.register(provider('b', ['movie', 'series']))
  expect(ctx.metadata.for('movie')?.id).toBe('a')
  expect(ctx.metadata.for('movie', 'b')?.id).toBe('b')
  expect(ctx.metadata.for('movie', 'missing')?.id).toBe('a')
  expect(ctx.metadata.for('series')?.id).toBe('b')
  expect(ctx.metadata.for('podcast')).toBeUndefined()
  expect(ctx.metadata.list()).toEqual([
    { id: 'a', kinds: ['movie'] },
    { id: 'b', kinds: ['movie', 'series'] },
  ])
})

it('announces changes and unregisters with the plugin that registered', async () => {
  let changes = 0
  ctx.on('metadata/providers', () => void changes++)
  const fiber = await ctx.plugin({
    name: 'fake',
    inject: ['metadata'],
    apply: (c: Context) => void c.metadata.register(provider('a', ['movie'])),
  })
  expect(ctx.metadata.get('a')).toBeDefined()
  await fiber.dispose()
  expect(ctx.metadata.get('a')).toBeUndefined()
  expect(changes).toBe(2)
})

it('refuses a duplicate id', () => {
  ctx.metadata.register(provider('a', ['movie']))
  expect(() => ctx.metadata.register(provider('a', ['series']))).toThrow(/already registered/)
})

it('lists only providers with discovery feeds for discovery', () => {
  ctx.metadata.register(provider('plain', ['movie']))
  ctx.metadata.register({
    ...provider('feeds', ['movie']),
    discoveryFeeds: [{ id: 'f', kind: 'movie', label: 'F' }],
    discover: async () => [],
  })
  expect(ctx.metadata.discovery().map((p) => p.id)).toEqual(['feeds'])
})
