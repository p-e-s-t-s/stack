import type { Span } from './types'

/** Word boundaries that treat letters and digits as word characters (not `_`). */
export const B = '(?<![A-Za-z0-9])'
export const E = '(?![A-Za-z0-9])'

export interface Hit {
  start: number
  end: number
  text: string
  groups: (string | undefined)[]
}

/**
 * Runs matchers over a copy of the input where `.` and `_` are spaces, so every match
 * maps back to the same positions in the original name.
 */
export class Scanner {
  readonly norm: string
  readonly spans: Span[] = []

  constructor(
    readonly input: string,
    /** Matches at or after this index only (e.g. after an anime `[Group]` prefix). */
    public from = 0,
    /** Matches before this index only (e.g. before trailing junk). */
    public to = input.length,
  ) {
    this.norm = input.replace(/[._]/g, ' ')
  }

  /** All matches of `pattern` (source without flags) inside [from, to). */
  all(pattern: string, flags = 'gi'): Hit[] {
    const re = compile(pattern, flags.includes('g') ? flags : flags + 'g')
    re.lastIndex = 0
    const hits: Hit[] = []
    for (const m of this.norm.slice(0, this.to).matchAll(re)) {
      const start = m.index!
      if (start < this.from) continue
      hits.push({
        start,
        end: start + m[0].length,
        text: this.input.slice(start, start + m[0].length),
        groups: m.slice(1),
      })
    }
    return hits
  }

  first(pattern: string, flags = 'i'): Hit | undefined {
    return this.all(pattern, flags)[0]
  }

  record(field: string, hit: Pick<Hit, 'start' | 'end'>) {
    this.spans.push({
      field,
      start: hit.start,
      end: hit.end,
      text: this.input.slice(hit.start, hit.end),
    })
  }
}

const cache = new Map<string, RegExp>()

function compile(pattern: string, flags: string) {
  const key = flags + '/' + pattern
  let re = cache.get(key)
  if (!re) cache.set(key, (re = new RegExp(pattern, flags)))
  return re
}

/** Builds `(?:a|b|c)` from alternatives. */
export const any = (...alternatives: string[]) => `(?:${alternatives.join('|')})`
