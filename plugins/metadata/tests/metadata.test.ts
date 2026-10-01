import type { MetadataProvider } from '@magpiejs/types'
import { Context } from 'cordis'
import { expect, it } from 'vitest'
import MetadataService from '../src'

const fake = (id: string, kinds: MetadataProvider['kinds']): MetadataProvider => ({
  id,
  kinds,
  search: async () => [],
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(MetadataService)
  return ctx
}

it('picks the preferred provider for a kind, else the first that supports it', async () => {
  const ctx = await setup()
  ctx.metadata.register(fake('a', ['movie']))
  ctx.metadata.register(fake('b', ['movie', 'series']))
  expect(ctx.metadata.for('movie')?.id).toBe('a')
  expect(ctx.metadata.for('movie', 'b')?.id).toBe('b')
  expect(ctx.metadata.for('movie', 'missing')?.id).toBe('a')
  expect(ctx.metadata.for('series', 'a')?.id).toBe('b') // 'a' does not do series
  expect(ctx.metadata.for('podcast')).toBeUndefined()
  expect(ctx.metadata.list()).toEqual([
    { id: 'a', kinds: ['movie'] },
    { id: 'b', kinds: ['movie', 'series'] },
  ])
})

it('only lists providers that offer discovery feeds', async () => {
  const ctx = await setup()
  ctx.metadata.register(fake('plain', ['movie']))
  ctx.metadata.register({
    ...fake('feeds', ['movie']),
    discoveryFeeds: [{ id: 'f', kind: 'movie', label: 'F' }],
    discover: async () => [],
  })
  ctx.metadata.register({
    ...fake('empty', ['movie']),
    discoveryFeeds: [],
    discover: async () => [],
  })
  expect(ctx.metadata.discovery().map((p) => p.id)).toEqual(['feeds'])
})

it('rejects a duplicate id, and unregisters when the registering scope is disposed', async () => {
  const ctx = await setup()
  const events: string[] = []
  ctx.on('metadata/providers', () => void events.push('changed'))
  const dispose = ctx.metadata.register(fake('x', ['movie']))
  expect(() => ctx.metadata.register(fake('x', ['series']))).toThrow('already registered')
  expect(ctx.metadata.get('x')).toBeDefined()
  dispose()
  expect(ctx.metadata.get('x')).toBeUndefined()
  expect(events).toEqual(['changed', 'changed'])
})
