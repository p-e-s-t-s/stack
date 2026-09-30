import { describe, expect, it } from 'vitest'
import { escape, payload } from '../src'

describe('discord payload', () => {
  it('cannot ping anyone or turn a release name into formatting', () => {
    const body = payload(
      { type: 'media.imported', title: '@everyone *Movie* [x](http://evil)', body: '_a_ @here' },
      'Magpie',
    )
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.embeds[0]!.title).toBe('@everyone \\*Movie\\* \\[x\\]\\(http://evil\\)')
    expect(body.embeds[0]!.description).toBe('\\_a\\_ @here')
  })

  it('keeps the embed within Discord limits', () => {
    const body = payload(
      { type: 'x', title: 'T'.repeat(500), body: 'B'.repeat(9000) },
      'M'.repeat(200),
    )
    expect(body.embeds[0]!.title).toHaveLength(256)
    expect(body.embeds[0]!.description).toHaveLength(4096)
    expect(body.username).toHaveLength(80)
  })

  it('escapes markdown characters', () => {
    expect(escape('a_b*c')).toBe('a\\_b\\*c')
  })
})
