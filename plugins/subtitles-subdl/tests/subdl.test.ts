import {
  SubtitleProviderError,
  type SubtitleRequirement,
  type SubtitleProvider,
  type SubtitleSearchContext,
} from '@magpiejs/types'
import { Context } from 'cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ json: vi.fn(), request: vi.fn() }))
vi.mock('@magpiejs/subtitles/transport', () => transport)

import * as subdl from '../src'
import { candidates } from '../src'

const movie: SubtitleSearchContext = {
  kind: 'movie',
  title: 'Dune',
  year: 2021,
  ids: {},
  releaseName: null,
  releaseGroup: null,
  size: 0,
  episodes: [],
}
const requirement: SubtitleRequirement = {
  id: 'r',
  language: 'en',
  forced: 'either',
  hi: 'either',
  embedded: false,
  formats: [],
  minimum: 0,
  cutoff: 0,
}
const signal = new AbortController().signal

describe('candidates', () => {
  const response = {
    status: true,
    results: [{ imdb_id: 'tt1', tmdb_id: 2, year: 2021 }],
    subtitles: [
      {
        release_name: 'Rel',
        url: '/subtitle/1.zip',
        language: 'EN',
        format: 'ass',
        forced: true,
        hi: false,
      },
      // a pack unpacks into its member files; a full season with no members yields nothing
      {
        release_name: 'Pack',
        unpack_files: [
          { url: '/subtitle/a', name: 'a.srt', season: 1, episode: 2, format: 'weird' },
          { name: 'no url' },
        ],
      },
      { release_name: 'Season', full_season: true, url: '/subtitle/season.zip' },
    ],
  }

  it('maps subtitles, unpacked members, and the feature ids', () => {
    const result = candidates(response, 'subdl:x', { ...movie, kind: 'series' })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: '/subtitle/1.zip',
      providerId: 'subdl:x',
      name: 'Rel',
      forced: true,
      hi: false,
      format: 'ass',
      ids: { imdb: 'tt1', tmdb: '2' },
      year: 2021,
    })
    // unknown formats fall back to srt; episode numbers only count for series
    expect(result[1]).toMatchObject({
      fileId: '/subtitle/a',
      name: 'a.srt',
      format: 'srt',
      releaseName: 'Pack',
      episodes: [{ season: 1, number: 2 }],
    })
    expect(candidates(response, 'p', movie)[1]?.episodes).toBeUndefined()
  })

  it('rejects a malformed or failed response', () => {
    expect(() => candidates({ status: true }, 'p', movie)).toThrow(SubtitleProviderError)
    expect(() => candidates({ status: false, subtitles: [] }, 'p', movie)).toThrow(
      SubtitleProviderError,
    )
  })
})

async function load() {
  const ctx = new Context()
  let provider!: SubtitleProvider
  ctx.provide('subtitles')
  ctx.set('subtitles', { register: (p: SubtitleProvider) => void (provider = p) })
  await ctx.plugin(subdl, { name: 'SubDL', apiKey: 'k&y', priority: 20, automatic: true })
  return provider
}
const lastUrl = () => new URL(transport.json.mock.calls.at(-1)![0] as string)

beforeEach(() => {
  transport.json.mockReset()
  transport.request.mockReset()
})

describe('search', () => {
  it('prefers imdb over tmdb over film_name, and maps movie and series types', async () => {
    transport.json.mockResolvedValue({ status: true, subtitles: [] })
    const provider = await load()
    await provider.search({ ...movie, ids: { imdb: 'tt1', tmdb: '2' } }, requirement, signal)
    let p = lastUrl().searchParams
    expect([p.get('api_key'), p.get('type'), p.get('imdb_id'), p.has('tmdb_id')]).toEqual([
      'k&y',
      'movie',
      'tt1',
      false,
    ])
    await provider.search(
      { ...movie, kind: 'series', ids: { tmdb: '2' }, episodes: [{ season: 3, number: 4 }] },
      requirement,
      signal,
    )
    p = lastUrl().searchParams
    expect([
      p.get('type'),
      p.get('tmdb_id'),
      p.get('season_number'),
      p.get('episode_number'),
    ]).toEqual(['tv', '2', '3', '4'])
    await provider.search(movie, requirement, signal)
    expect(lastUrl().searchParams.get('film_name')).toBe('Dune')
  })

  it("uses SubDL's own code for Brazilian Portuguese and upper-cases others", async () => {
    transport.json.mockResolvedValue({ status: true, subtitles: [] })
    const provider = await load()
    await provider.search(movie, { ...requirement, language: 'pt-BR' }, signal)
    expect(lastUrl().searchParams.get('languages')).toBe('BR_PT')
    await provider.search(movie, requirement, signal)
    expect(lastUrl().searchParams.get('languages')).toBe('EN')
  })
})

describe('download', () => {
  it('fetches only from dl.subdl.com/subtitle/', async () => {
    transport.request.mockResolvedValue({ bytes: Buffer.from('ok') })
    const provider = await load()
    expect(
      (await provider.download({ fileId: '/subtitle/1.zip' } as never, signal)).toString(),
    ).toBe('ok')
    expect(transport.request.mock.calls[0]![0]).toBe('https://dl.subdl.com/subtitle/1.zip')
  })

  it.each([
    'https://evil.example/subtitle/1',
    'http://dl.subdl.com/subtitle/1',
    '/other/1.zip',
    '//evil.example/subtitle/1',
  ])('refuses %s', async (fileId) => {
    const provider = await load()
    await expect(provider.download({ fileId } as never, signal)).rejects.toMatchObject({
      code: 'invalid',
    })
    expect(transport.request).not.toHaveBeenCalled()
  })
})

describe('test', () => {
  it('passes with a valid key and reports a rejected one as an auth error', async () => {
    const provider = await load()
    transport.json.mockResolvedValueOnce({ status: true })
    await expect(provider.test(signal)).resolves.toContain('working')
    expect(lastUrl().searchParams.get('api_key')).toBe('k&y')
    transport.json.mockResolvedValueOnce({ status: false })
    await expect(provider.test(signal)).rejects.toMatchObject({ code: 'auth' })
  })
})
