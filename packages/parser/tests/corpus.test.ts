// Every collected release name must agree with the metadata xrel.to recorded for it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '../src'

interface Entry {
  name: string
  type: 'movie' | 'tv'
  season?: number
  episode?: number
  group?: string
  source: 'scene' | 'p2p'
}

const corpus: Entry[] = readFileSync(new URL('./corpus/xrel.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

describe('xrel corpus', () => {
  it('has names to check', () => {
    expect(corpus.length).toBeGreaterThan(1000)
  })

  it('matches season and episode of every scene TV release', () => {
    const wrong = corpus
      .filter((e) => e.source === 'scene' && e.season && e.episode)
      .filter((e) => {
        const { episodes } = parse(e.name)
        return episodes?.season !== e.season || !episodes?.numbers.includes(e.episode!)
      })
    expect(wrong.map((e) => e.name)).toEqual([])
  })

  it('matches the release group', () => {
    const wrong = corpus
      .filter((e) => e.group)
      .filter((e) => parse(e.name).group?.toLowerCase() !== e.group!.toLowerCase())
    expect(wrong.map((e) => e.name)).toEqual([])
  })

  it('treats every movie as a movie', () => {
    const wrong = corpus.filter((e) => e.type === 'movie' && parse(e.name).kind !== 'movie')
    expect(wrong.map((e) => e.name)).toEqual([])
  })

  it('finds a title for every name', () => {
    expect(corpus.filter((e) => !parse(e.name).title).map((e) => e.name)).toEqual([])
  })

  it('parses 10,000 names in under a second', () => {
    const names = Array.from({ length: 10_000 }, (_, i) => corpus[i % corpus.length]!.name)
    for (const name of names.slice(0, 500)) parse(name) // warm up
    const start = performance.now()
    for (const name of names) parse(name)
    const ms = performance.now() - start
    console.log(`parsed 10,000 names in ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(process.env.CI ? 2000 : 1000)
  })
})
