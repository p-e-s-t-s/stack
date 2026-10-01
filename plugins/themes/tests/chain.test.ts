import { describe, expect, it } from 'vitest'
import { chainOf, resolveChain } from '../src/chain'

const themes = new Map<string, { extends?: string }>([
  ['tv', { extends: 'compact' }],
  ['compact', {}],
  ['orphan', { extends: 'missing' }],
  ['a', { extends: 'b' }],
  ['b', { extends: 'a' }],
])

describe('chainOf', () => {
  it('lists the theme, its parents, then the default', () => {
    expect(chainOf('compact', themes)).toEqual(['compact', 'default'])
    expect(chainOf('tv', themes)).toEqual(['tv', 'compact', 'default'])
    expect(chainOf('default', themes)).toEqual(['default'])
  })

  it('is undefined for unknown themes, missing parents and loops', () => {
    expect(chainOf('nope', themes)).toBeUndefined()
    expect(chainOf('orphan', themes)).toBeUndefined()
    expect(chainOf('a', themes)).toBeUndefined()
  })
})

describe('resolveChain', () => {
  it('uses the first available choice', () => {
    expect(resolveChain(['tv', 'compact'], themes)).toEqual(['tv', 'compact', 'default'])
    expect(resolveChain([null, 'compact'], themes)).toEqual(['compact', 'default'])
  })

  it('skips an unavailable choice and falls back to the next', () => {
    expect(resolveChain(['orphan', 'compact'], themes)).toEqual(['compact', 'default'])
    expect(resolveChain(['uninstalled', undefined], themes)).toEqual(['default'])
  })

  it('is the default alone when nothing is chosen', () => {
    expect(resolveChain([], themes)).toEqual(['default'])
  })
})
