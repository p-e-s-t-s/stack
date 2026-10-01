import { describe, expect, it } from 'vitest'
import { selectPart } from '../src/themes'

const reg = (theme: string | undefined, disabled = false) => ({
  theme,
  disabled: () => disabled,
})

describe('selectPart', () => {
  it('prefers the most specific theme in the chain', () => {
    const tv = reg('tv')
    const compact = reg('compact')
    expect(selectPart([compact, tv], ['tv', 'compact', 'default'])).toBe(tv)
    expect(selectPart([compact, tv], ['compact', 'tv', 'default'])).toBe(compact)
  })

  it('falls through to a parent when the child does not provide the part', () => {
    const parent = reg('compact')
    expect(selectPart([parent], ['tv', 'compact', 'default'])).toBe(parent)
  })

  it('ignores themes outside the chain and disabled registrations', () => {
    expect(selectPart([reg('other')], ['tv', 'default'])).toBeUndefined()
    expect(selectPart([reg('tv', true)], ['tv', 'default'])).toBeUndefined()
  })

  it('returns nothing when the default should render', () => {
    expect(selectPart([], ['default'])).toBeUndefined()
    expect(selectPart([reg(undefined)], ['default'])).toBeUndefined()
  })

  it('can drop a registration that failed to render', () => {
    const tv = reg('tv')
    const compact = reg('compact')
    expect(selectPart([tv, compact], ['tv', 'compact', 'default'], (c) => c === tv)).toBe(compact)
    expect(selectPart([tv], ['tv', 'default'], () => true)).toBeUndefined()
  })
})
