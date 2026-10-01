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

import * as opensubtitles from '../src'
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

const row = (over: Record<string, unknown> = {}) => ({
  id: '77',
  attributes: {
    language: 'en',
    release: 'Dune.2021.1080p',
    foreign_parts_only: false,
    hearing_impaired: true,
    moviehash_match: true,
    feature_details: {
      imdb_id: 1160419,
      tmdb_id: 438631,
      year: 2021,
      season_number: 1,
      episode_number: 3,
      parent_imdb_id: 9,
      parent_tmdb_id: 8,
    },
    files: [{ file_id: 123, file_name: 'dune.srt' }, { file_id: 'bad' }],
    ...over,
  },
})

describe('candidates', () => {
  it('maps rows to candidates, keeping only files with an integer id', () => {
    expect(candidates({ data: [row()] }, 'os:x', movie)).toEqual([
      {
        id: '77:123',
        providerId: 'os:x',
        fileId: '123',
        name: 'dune.srt',
        language: 'en',
        forced: false,
        hi: true,
        format: 'srt',
        ids: { imdb: 'tt1160419', tmdb: '438631' },
        year: 2021,
        episodes: undefined,
        releaseName: 'Dune.2021.1080p',
        hashMatch: true,
      },
    ])
  })

  it('uses the parent ids and episode numbers for series', () => {
    const [c] = candidates({ data: [row()] }, 'os:x', { ...movie, kind: 'series' })
    expect(c?.ids).toEqual({ imdb: 'tt9', tmdb: '8' })
    expect(c?.episodes).toEqual([{ season: 1, number: 3 }])
  })

  it('does not double the tt prefix and reports unknown flags as null', () => {
    const [c] = candidates(
      {
        data: [
          row({
            foreign_parts_only: undefined,
            hearing_impaired: undefined,
            moviehash_match: false,
            feature_details: { imdb_id: 'tt5' },
          }),
        ],
      },
      'p',
      movie,
    )
    expect(c).toMatchObject({ ids: { imdb: 'tt5' }, forced: null, hi: null, hashMatch: false })
  })

  it('skips rows without files and rejects a malformed response', () => {
    expect(candidates({ data: [{ id: '1' }, { id: '2', attributes: {} }] }, 'p', movie)).toEqual([])
    expect(() => candidates({}, 'p', movie)).toThrow(SubtitleProviderError)
  })
})

async function load(config: Partial<opensubtitles.Config> = {}) {
  const ctx = new Context()
  let provider!: SubtitleProvider
  const quota = vi.fn()
  ctx.provide('subtitles')
  ctx.set('subtitles', { register: (p: SubtitleProvider) => void (provider = p), quota })
  await ctx.plugin(opensubtitles, {
    name: 'OS',
    apiKey: 'k',
    username: '',
    password: '',
    userAgent: 'UA',
    priority: 10,
    automatic: true,
    ...config,
  })
  return { provider, quota }
}

const lastUrl = () => new URL(transport.json.mock.calls.at(-1)![0] as string)

beforeEach(() => {
  transport.json.mockReset()
  transport.request.mockReset()
})

describe('search', () => {
  it('prefers imdb over tmdb over a title query, and sends the api key', async () => {
    transport.json.mockResolvedValue({ data: [] })
    const { provider } = await load()
    await provider.search({ ...movie, ids: { imdb: 'tt1160419', tmdb: '1' } }, requirement, signal)
    expect(lastUrl().searchParams.get('imdb_id')).toBe('1160419')
    expect(lastUrl().searchParams.has('tmdb_id')).toBe(false)
    expect(transport.json.mock.calls.at(-1)![1].headers['Api-Key']).toBe('k')

    await provider.search({ ...movie, ids: { tmdb: '1' } }, requirement, signal)
    expect(lastUrl().searchParams.get('tmdb_id')).toBe('1')
    await provider.search(movie, requirement, signal)
    expect(lastUrl().searchParams.get('query')).toBe('Dune')
  })

  it('searches episodes by parent id and a single season and episode', async () => {
    transport.json.mockResolvedValue({ data: [] })
    const { provider } = await load()
    await provider.search(
      { ...movie, kind: 'series', ids: { imdb: 'tt9' }, episodes: [{ season: 2, number: 5 }] },
      requirement,
      signal,
    )
    const p = lastUrl().searchParams
    expect(p.get('type')).toBe('episode')
    expect(p.get('parent_imdb_id')).toBe('9')
    expect([p.get('season_number'), p.get('episode_number')]).toEqual(['2', '5'])
    await provider.search(
      {
        ...movie,
        kind: 'series',
        episodes: [
          { season: 1, number: 1 },
          { season: 1, number: 2 },
        ],
      },
      requirement,
      signal,
    )
    expect(lastUrl().searchParams.has('season_number')).toBe(false)
  })

  it('translates the forced and hearing-impaired requirements', async () => {
    transport.json.mockResolvedValue({ data: [] })
    const { provider } = await load()
    await provider.search(
      { ...movie, hash: 'abc' },
      { ...requirement, forced: 'forced', hi: 'require' },
      signal,
    )
    let p = lastUrl().searchParams
    expect([p.get('moviehash'), p.get('foreign_parts_only'), p.get('hearing_impaired')]).toEqual([
      'abc',
      'only',
      'only',
    ])
    await provider.search(movie, { ...requirement, forced: 'full', hi: 'exclude' }, signal)
    p = lastUrl().searchParams
    expect([p.get('foreign_parts_only'), p.get('hearing_impaired')]).toEqual(['exclude', 'exclude'])
    await provider.search(movie, { ...requirement, hi: 'prefer' }, signal)
    p = lastUrl().searchParams
    expect([p.has('foreign_parts_only'), p.has('hearing_impaired')]).toEqual([false, false])
  })
})

describe('download', () => {
  const candidate = { fileId: '123' } as never

  it('records the remaining quota and fetches the file', async () => {
    transport.json.mockResolvedValue({
      link: 'https://dl.opensubtitles.com/x.srt',
      remaining: 4,
      reset_time_utc: '2030-01-01T00:00:00Z',
    })
    transport.request.mockResolvedValue({ bytes: Buffer.from('subs') })
    const { provider, quota } = await load()
    expect((await provider.download(candidate, signal)).toString()).toBe('subs')
    expect(quota).toHaveBeenCalledWith(provider.id, 4, Date.parse('2030-01-01T00:00:00Z'))
    expect(JSON.parse(transport.json.mock.calls[0]![1].body)).toEqual({
      file_id: 123,
      sub_format: 'srt',
    })
  })

  it('reports quota exhaustion when no link comes back', async () => {
    transport.json.mockResolvedValue({ remaining: 0 })
    const { provider } = await load()
    await expect(provider.download(candidate, signal)).rejects.toMatchObject({ code: 'quota' })
    expect(transport.request).not.toHaveBeenCalled()
  })

  it.each([
    'http://dl.opensubtitles.com/x',
    'https://evil.example/x',
    'https://notopensubtitles.com/x',
    'https://opensubtitles.com.evil.example/x',
  ])('refuses to download from %s', async (link) => {
    transport.json.mockResolvedValue({ link, remaining: 1 })
    const { provider } = await load()
    await expect(provider.download(candidate, signal)).rejects.toMatchObject({ code: 'invalid' })
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('logs in once with credentials and sends the bearer token afterwards', async () => {
    transport.json
      .mockResolvedValueOnce({ token: 'T' })
      .mockResolvedValue({ link: 'https://dl.opensubtitles.com/x', remaining: 1 })
    transport.request.mockResolvedValue({ bytes: Buffer.alloc(0) })
    const { provider } = await load({ username: 'u', password: 'p' })
    await provider.download(candidate, signal)
    await provider.download(candidate, signal)
    const urls = transport.json.mock.calls.map((c) => c[0] as string)
    expect(urls.filter((u) => u.endsWith('/login'))).toHaveLength(1)
    expect(transport.json.mock.calls.at(-1)![1].headers.Authorization).toBe('Bearer T')
  })

  it('fails with an auth error when login returns no token', async () => {
    transport.json.mockResolvedValue({})
    const { provider } = await load({ username: 'u', password: 'p' })
    await expect(provider.download(candidate, signal)).rejects.toMatchObject({ code: 'auth' })
  })
})
