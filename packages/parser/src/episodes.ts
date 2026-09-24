import { B, E, type Hit, type Scanner } from './scanner'
import type { Episodes } from './types'

export interface EpisodeMatch {
  episodes: Episodes
  kind: 'episode' | 'season'
  hit: Hit
}

function range(from: number, to: number) {
  if (to < from || to - from > 100) return [from]
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** `E01E02`, `E01-E03`, `E01-03`, `E01+E02` → episode numbers. */
function episodeList(text: string) {
  const numbers: number[] = []
  const re = /E(\d{1,4})(?:[ -]?(?:-|~|to)[ -]?E?(\d{1,4}))?/gi
  for (const m of text.matchAll(re)) {
    const from = Number(m[1])
    numbers.push(...(m[2] ? range(from, Number(m[2])) : [from]))
  }
  return [...new Set(numbers)]
}

const MAX_YEAR = new Date().getFullYear() + 1

export function findEpisodes(s: Scanner): EpisodeMatch | undefined {
  // S01E01, S01E01E02, S01E01-E03, S01 E01, S01E01-03
  const eps = `E\\d{1,4}(?:(?:[ ]?[-~+][ ]?E?|E)\\d{1,4})*`
  let hit = s.first(`${B}S(\\d{1,4})[ -]?(${eps})${E}`)
  if (hit) {
    const season = Number(hit.groups[0])
    const numbers = episodeList(hit.groups[1]!)
    return {
      kind: 'episode',
      hit,
      episodes: { season, numbers, ...(season === 0 && { special: true }) },
    }
  }

  // 1x01, 1x01-1x02
  hit = s.first(`${B}(\\d{1,2})x(\\d{2,3})(?:-(?:\\d{1,2}x)?(\\d{2,3}))?${E}`)
  if (hit) {
    const season = Number(hit.groups[0])
    const first = Number(hit.groups[1])
    const numbers = hit.groups[2] ? range(first, Number(hit.groups[2])) : [first]
    return { kind: 'episode', hit, episodes: { season, numbers } }
  }

  // Daily: 2026.09.23, 2026-09-23
  hit = s.first(`${B}((?:19|20)\\d{2})[ -](0[1-9]|1[0-2])[ -](0[1-9]|[12]\\d|3[01])${E}`)
  if (hit && Number(hit.groups[0]) <= MAX_YEAR) {
    const [y, m, d] = hit.groups
    return { kind: 'episode', hit, episodes: { numbers: [], airDate: `${y}-${m}-${d}` } }
  }

  // Season packs: S01, S01-S03, S01-03, Season 1, Season 1-3
  // (a range needs `S01-03`/`S01-S03` or `S01 - S03`, so anime `S2 - 04` stays one season)
  hit = s.first(
    `${B}(?:S(\\d{1,4})(?:-S?(\\d{1,4})|[ ]-[ ]S(\\d{1,4}))?|Season[ -]?(\\d{1,3})(?:[ ]?-[ ]?(\\d{1,3}))?)${E}`,
  )
  if (hit) {
    const first = Number(hit.groups[0] ?? hit.groups[3])
    const last = hit.groups[1] ?? hit.groups[2] ?? hit.groups[4]
    const seasons = last ? range(first, Number(last)) : [first]
    return {
      kind: 'season',
      hit,
      episodes: {
        season: seasons.length === 1 ? first : undefined,
        numbers: [],
        ...(seasons.length > 1 && { seasons }),
        ...(first === 0 && { special: true }),
      },
    }
  }

  // Episode without season: E13, Ep13, Episode 13
  hit = s.first(`${B}(?:E|Ep|Episode[ ]?)(\\d{1,4})${E}`)
  if (hit) {
    return { kind: 'episode', hit, episodes: { numbers: [Number(hit.groups[0])] } }
  }
}
