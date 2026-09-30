import { SubtitleProviderError, type SubtitleSearchContext } from '@magpiejs/types'
import { Context, Service } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as subdl from '../src'
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

const RESPONSE = {
  status: true,
  results: [{ imdb_id: 'tt0133093', tmdb_id: 603, year: 1999 }],
  subtitles: [
    {
      release_name: 'Matrix.1080p',
      unpack_files: [
        {
          url: '/subtitle/1.srt',
          name: 'a.srt',
          language: 'EN',
          format: 'srt',
          hi: true,
          forced: false,
        },
        { url: '/subtitle/2.ass', release_name: 'Matrix.ass', language: 'EN', format: 'weird' },
        { name: 'no url' },
      ],
    },
    { url: '/subtitle/3.zip', release_name: 'Single', language: 'EN' },
    { full_season: true, url: '/subtitle/4.zip', language: 'EN' },
  ],
}

describe('candidates', () => {
  it('flattens archives, taking ids from the matched feature', () => {
    const found = candidates(RESPONSE, 'subdl:x', query())
    expect(found.map((c) => [c.fileId, c.name, c.format, c.hi, c.forced])).toEqual([
      ['/subtitle/1.srt', 'a.srt', 'srt', true, false],
      ['/subtitle/2.ass', 'Matrix.ass', 'srt', null, null], // unknown formats fall back to srt
      ['/subtitle/3.zip', 'Single', 'srt', null, null],
    ])
    expect(found[0]).toMatchObject({
      providerId: 'subdl:x',
      ids: { imdb: 'tt0133093', tmdb: '603' },
      year: 1999,
      releaseName: 'Matrix.1080p',
    })
  })

  it('reports episode numbers only for series searches', () => {
    const data = {
      status: true,
      subtitles: [{ url: '/subtitle/1', language: 'EN', season: 2, episode: 5 }],
    }
    expect(candidates(data, 'p', query({ kind: 'series' }))[0]!.episodes).toEqual([
      { season: 2, number: 5 },
    ])
    expect(candidates(data, 'p', query())[0]!.episodes).toBeUndefined()
  })

  it('rejects a malformed or failed response', () => {
    expect(() => candidates({ status: false }, 'p', query())).toThrow(SubtitleProviderError)
    expect(() => candidates({ status: true }, 'p', query())).toThrow(/invalid SubDL/)
  })
})

describe('provider', () => {
  afterEach(() => vi.restoreAllMocks())

  async function boot() {
    const ctx = new Context()
    await ctx.plugin(FakeSubtitles)
    await ctx.plugin(subdl, { name: 'SubDL', apiKey: 'k', priority: 20, automatic: true })
    return (ctx as any).subtitles.registered[0]
  }

  it('searches by imdb id, then episode, and sends the api key', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(RESPONSE)))
    const provider = await boot()
    const results = await provider.search(
      query({ kind: 'series', ids: { imdb: 'tt1' }, episodes: [{ season: 1, number: 2 }] }),
      { language: 'pt-BR' },
      new AbortController().signal,
    )
    expect(results).toHaveLength(3)
    const url = new URL(String(fetch.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://api.subdl.com/api/v1/subtitles')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      api_key: 'k',
      type: 'tv',
      languages: 'BR_PT',
      imdb_id: 'tt1',
      season_number: '1',
      episode_number: '2',
    })
  })

  it('downloads only from the SubDL download host', async () => {
    const provider = await boot()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('subtitle bytes'))
    const signal = new AbortController().signal
    for (const fileId of [
      'https://evil.example/subtitle/1',
      'https://dl.subdl.com/other/1',
      'http://dl.subdl.com/subtitle/1',
    ])
      await expect(provider.download({ fileId }, signal)).rejects.toThrow(
        /invalid SubDL download URL/,
      )
    expect(fetch).not.toHaveBeenCalled()
    const bytes = await provider.download({ fileId: '/subtitle/1.zip' }, signal)
    expect(String(fetch.mock.calls[0]![0])).toBe('https://dl.subdl.com/subtitle/1.zip')
    expect(bytes.toString()).toBe('subtitle bytes')
  })

  it('reports a rejected key from the connection test', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ status: false })),
    )
    const provider = await boot()
    await expect(provider.test(new AbortController().signal)).rejects.toMatchObject({
      code: 'auth',
    })
  })
})
