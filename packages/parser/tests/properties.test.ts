import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parse } from '../src'

const token = fc.constantFrom(
  'The',
  'Movie',
  'Show',
  '2019',
  'S01E02',
  'S03',
  '1080p',
  '2160p',
  'BluRay',
  'WEB-DL',
  'WEB',
  'x264',
  'HEVC',
  'DDP5.1',
  'Atmos',
  'DV',
  'HDR',
  'REPACK',
  'PROPER',
  'GERMAN',
  'DL',
  'MULTi',
  'AMZN',
  'NF',
  'Remux',
  'iNTERNAL',
  '[Group]',
  '-',
  '(2020)',
  '2026.09.23',
  'E13',
  '1x05',
)
const releaseName = fc
  .tuple(
    fc.array(token, { minLength: 1, maxLength: 12 }),
    fc.constantFrom('.', ' ', '_'),
    fc.stringMatching(/^[A-Za-z0-9]{0,8}$/),
  )
  .map(([tokens, sep, group]) => tokens.join(sep) + (group ? `-${group}` : ''))

describe('parser properties', () => {
  it('never throws, on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (name) => void parse(name)),
      { numRuns: 2000 },
    )
  })

  it('keeps spans inside the input and matching its text', () => {
    fc.assert(
      fc.property(releaseName, (name) => {
        for (const span of parse(name).spans) {
          expect(span.start).toBeGreaterThanOrEqual(0)
          expect(span.end).toBeLessThanOrEqual(name.length)
          expect(span.text).toBe(name.slice(span.start, span.end))
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('gives the same result for dots, spaces and underscores', () => {
    fc.assert(
      fc.property(fc.array(token, { minLength: 2, maxLength: 10 }), (tokens) => {
        const strip = ({ input: _, spans: __, title, ...rest }: ReturnType<typeof parse>) => ({
          ...rest,
          title: title.toLowerCase(),
        })
        const dotted = strip(parse(tokens.join('.')))
        expect(strip(parse(tokens.join(' ')))).toEqual(dotted)
        expect(strip(parse(tokens.join('_')))).toEqual(dotted)
      }),
      { numRuns: 1000 },
    )
  })
})
