import { SubtitleProviderError, type SubtitleSearchContext } from '@magpiejs/types'
import { Context, Service } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as opensubtitles from '../src'
import { candidates } from '../src'

/** Stands in for the subtitles service: keeps what registers, and any quota reported. */
class FakeSubtitles extends Service {
  registered: any[] = []
  quotas: unknown[][] = []
  constructor(ctx: Context) {
    super(ctx, 'subtitles')
  }
  register(provider: any) {
    this.registered.push(provider)
  }
  quota(...args: unknown[]) {
    this.quotas.push(args)
  }
}

const query = (over: Partial<SubtitleSearchContext> = {}): SubtitleSearchContext => ({
  kind: 'movie',
  title: 'The Matrix',
  year: 1999,
  ids: {},
  releaseName: null,
  releaseGroup: null,
  size: 0,
  episodes: [],
  ...over,
})

const row = (over: Record<string, unknown> = {}) => ({
  id: '77',
  attributes: {
    language: 'en',
    release: 'Matrix.1080p',
    foreign_parts_only: false,
    hearing_impaired: true,
    moviehash_match: true,
    feature_details: {
      imdb_id: 133093,
      tmdb_id: 603,
      year: 1999,
      parent_imdb_id: 944947,
      parent_tmdb_id: 1399,
      season_number: 2,
      episode_number: 5,
    },
    files: [{ file_id: 1001, file_name: 'matrix.srt' }, { file_id: 'bad' }],
    ...over,
  },
})

describe('candidates', () => {
  it('maps a movie result, normalising ids and skipping files without a numeric id', () => {
    const found = candidates({ data: [row(), { id: '1', attributes: {} }] }, 'os:x', query())
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      id: '77:1001',
      fileId: '1001',
      name: 'matrix.srt',
      providerId: 'os:x',
      forced: false,
      hi: true,
      hashMatch: true,
      format: 'srt',
      ids: { imdb: 'tt133093', tmdb: '603' },
      year: 1999,
      releaseName: 'Matrix.1080p',
      episodes: undefined,
    })
  })

  it('uses the parent ids and episode numbers for series', () => {
    const [c] = candidates({ data: [row()] }, 'os:x', query({ kind: 'series' }))
    expect(c).toMatchObject({
      ids: { imdb: 'tt944947', tmdb: '1399' },
      episodes: [{ season: 2, number: 5 }],
    })
  })

  it('rejects a malformed response', () => {
    expect(() => candidates({}, 'p', query())).toThrow(SubtitleProviderError)
  })
})

describe('provider', () => {
  afterEach(() => vi.restoreAllMocks())

  async function boot(over: Record<string, unknown> = {}) {
    const ctx = new Context()
    await ctx.plugin(FakeSubtitles)
    await ctx.plugin(opensubtitles, {
      name: 'OpenSubtitles',
      apiKey: 'key',
      username: '',
      password: '',
      userAgent: 'Test v1',
      priority: 10,
      automatic: true,
      ...over,
    })
    const fake = (ctx as any).subtitles as FakeSubtitles
    return { provider: fake.registered[0], quotas: fake.quotas }
  }
  const signal = new AbortController().signal

  it('searches with ids, hash and filters', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify({ data: [row()] })))
    const { provider } = await boot()
    await provider.search(
      query({
        kind: 'series',
        hash: 'abc',
        ids: { imdb: 'tt944947' },
        episodes: [{ season: 2, number: 5 }],
      }),
      { language: 'en', forced: 'forced', hi: 'exclude' },
      signal,
    )
    const [href, init] = fetch.mock.calls[0]!
    const url = new URL(String(href))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      languages: 'en',
      type: 'episode',
      moviehash: 'abc',
      parent_imdb_id: '944947',
      season_number: '2',
      episode_number: '5',
      foreign_parts_only: 'only',
      hearing_impaired: 'exclude',
    })
    expect((init as RequestInit).headers).toMatchObject({
      'Api-Key': 'key',
      'User-Agent': 'Test v1',
    })
  })

  it('logs in, records the quota and downloads from an opensubtitles host', async () => {
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const href = String(input)
      calls.push(href)
      if (href.endsWith('/login')) return new Response(JSON.stringify({ token: 'tok' }))
      if (href.endsWith('/download')) {
        expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok')
        return new Response(
          JSON.stringify({
            link: 'https://dl.opensubtitles.com/file.srt',
            remaining: 4,
            reset_time_utc: '2030-01-01T00:00:00Z',
          }),
        )
      }
      return new Response('srt bytes')
    })
    const { provider, quotas } = await boot({ username: 'u', password: 'p' })
    const bytes = await provider.download({ fileId: '1001' }, signal)
    expect(bytes.toString()).toBe('srt bytes')
    expect(quotas[0]).toEqual([
      expect.stringMatching(/^opensubtitles:/),
      4,
      Date.parse('2030-01-01T00:00:00Z'),
    ])
    expect(calls.at(-1)).toBe('https://dl.opensubtitles.com/file.srt')
  })

  it('refuses a download link on another host, and reports a missing link as quota', async () => {
    const responses = [
      { link: 'https://evil.example/file.srt', remaining: 1 },
      { remaining: 0, reset_time_utc: '2030-01-01T00:00:00Z' },
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(responses.shift())),
    )
    const { provider } = await boot()
    await expect(provider.download({ fileId: '1' }, signal)).rejects.toMatchObject({
      code: 'invalid',
    })
    await expect(provider.download({ fileId: '1' }, signal)).rejects.toMatchObject({
      code: 'quota',
      retryAt: Date.parse('2030-01-01T00:00:00Z'),
    })
  })

  it('fails the login when no token comes back', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    const { provider } = await boot({ username: 'u', password: 'p' })
    await expect(provider.test(signal)).rejects.toMatchObject({ code: 'auth' })
  })
})
