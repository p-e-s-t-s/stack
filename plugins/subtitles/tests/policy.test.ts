import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { SubtitleCandidate, SubtitleRequirement, SubtitleSearchContext } from '@magpiejs/types'
import { candidates as openSubtitles } from '../../subtitles-opensubtitles/src/index'
import { decode, sidecar, shifted, unpack, validateText } from '../src/files'
import {
  DEFAULT_POLICY,
  accepts,
  evaluate,
  language,
  scoreCandidate,
  validateProfile,
} from '../src/policy'
import type { Inventory, Profile } from '../src/schema'

const req: SubtitleRequirement = {
  id: 'en',
  language: 'en',
  forced: 'full',
  hi: 'either',
  embedded: true,
  formats: ['srt'],
  minimum: 80,
  cutoff: 90,
}
const movie: SubtitleSearchContext = {
  kind: 'movie',
  title: 'Movie',
  year: 2020,
  ids: { imdb: 'tt1' },
  releaseName: 'Movie.2020.1080p.BluRay-GRP',
  releaseGroup: 'GRP',
  size: 1,
  episodes: [],
}
const cand = (over: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({
  id: '1',
  providerId: 'p',
  fileId: '1',
  name: 'x',
  language: 'en',
  forced: false,
  hi: false,
  format: 'srt',
  ids: { imdb: 'tt1' },
  ...over,
})
const profile = (over: Partial<Profile['policy']> = {}) =>
  ({
    id: 1,
    revision: 1,
    name: 'p',
    requirements: [req],
    policy: { ...DEFAULT_POLICY, automatic: true, ...over },
  }) as Profile
const row = (over: Partial<Inventory> = {}) =>
  ({
    present: true,
    valid: true,
    embedded: false,
    language: 'en',
    forced: false,
    hi: false,
    format: 'srt',
    managed: true,
    protected: false,
    score: 80,
    acquiredAt: 1000,
    ...over,
  }) as Inventory

describe('language', () => {
  it('normalizes aliases and keeps regions; unknown stays null', () => {
    expect(language('eng')).toBe('en')
    expect(language('pob')).toBe('pt-BR')
    expect(language('pt_BR')).toBe('pt-BR')
    expect(language('und')).toBeNull()
    expect(language(undefined)).toBeNull()
  })
})

describe('validateProfile', () => {
  const base = { name: 'P', requirements: [req] }
  it('accepts a valid profile and rejects cutoff below minimum or duplicates', () => {
    expect(validateProfile(base).policy.automatic).toBe(false)
    expect(() => validateProfile({ ...base, requirements: [{ ...req, cutoff: 10 }] })).toThrow(
      /cutoff/,
    )
    expect(() => validateProfile({ ...base, requirements: [req, { ...req, id: 'b' }] })).toThrow(
      /duplicate/,
    )
  })
})

describe('sidecar', () => {
  it('matches only exact-basename sidecars with one language', () => {
    expect(sidecar('/m/Movie.mkv', 'Movie.en.forced.srt')).toMatchObject({
      language: 'en',
      forced: true,
      format: 'srt',
    })
    expect(sidecar('/m/Movie.mkv', 'Movie.en.hi.ass')).toMatchObject({ hi: true, format: 'ass' })
    expect(sidecar('/m/Movie.mkv', 'Movie.srt')).toMatchObject({ language: null })
    expect(sidecar('/m/Movie.mkv', 'Other.en.srt')).toBeNull()
    expect(sidecar('/m/Movie.mkv', 'Movie.part2.en.srt')).toBeNull()
  })
})

describe('text validation', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello\n'
  it('parses cues, rejects bad timing and duration overflow, and shifts', () => {
    expect(validateText(srt, 'srt')).toHaveLength(1)
    expect(() => validateText('nonsense', 'srt')).toThrow()
    expect(() => validateText('1\n00:10:00,000 --> 00:10:01,000\nHi\n', 'srt', 60)).toThrow(
      /duration/,
    )
    expect(shifted(srt, 'srt', 1.5)).toContain('00:00:02,500 --> 00:00:03,500')
    expect(() => shifted(srt, 'srt', -5)).toThrow(/negative/)
  })
  it('rejects binary and non-UTF-8 content', () => {
    expect(() => decode(new Uint8Array([0xff, 0xd8, 0x00]))).toThrow()
    expect(() => decode(new Uint8Array())).toThrow()
  })
  it('refuses traversal and multi-member archives', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(() => unpack(zipSync({ '../evil.srt': enc(srt) }), 'srt')).toThrow(/unsafe/)
    expect(() => unpack(zipSync({ 'a.srt': enc(srt), 'b.srt': enc(srt) }), 'srt')).toThrow(
      /exactly one/,
    )
    expect(new TextDecoder().decode(unpack(zipSync({ 'a.srt': enc(srt) }), 'srt'))).toBe(srt)
  })
})

describe('scoring', () => {
  it('scores hash 100, exact release 90, group 80, identity 60', () => {
    expect(scoreCandidate(cand({ hashMatch: true }), movie, req).score).toBe(100)
    expect(
      scoreCandidate(cand({ releaseName: 'movie.2020.1080p.bluray-grp.srt' }), movie, req).score,
    ).toBe(90)
    expect(scoreCandidate(cand({ releaseName: 'Other.Thing-GRP' }), movie, req).score).toBe(80)
    const low = scoreCandidate(cand(), movie, req)
    expect(low.score).toBe(60)
    expect(low.reasons.join()).toMatch(/below minimum/)
  })
  it('rejects identity conflicts and unverified identity, and is deterministic', () => {
    const conflict = scoreCandidate(cand({ hashMatch: true, ids: { imdb: 'tt2' } }), movie, req)
    expect(conflict.reasons).toContain('imdb identity conflict')
    expect(scoreCandidate(cand({ ids: {} }), movie, req).reasons).toContain(
      'identity unverified; manual selection only',
    )
    expect(scoreCandidate(cand({ hashMatch: true }), movie, req)).toEqual(
      scoreCandidate(cand({ hashMatch: true }), movie, req),
    )
  })
  it('requires full episode coverage for series', () => {
    const q: SubtitleSearchContext = {
      ...movie,
      kind: 'series',
      episodes: [
        { season: 1, number: 1 },
        { season: 1, number: 2 },
      ],
    }
    expect(
      scoreCandidate(cand({ episodes: [{ season: 1, number: 1 }] }), q, req).reasons,
    ).toContain('episode coverage missing or conflicting')
  })
  it('unknown flags cannot satisfy strict rules', () => {
    expect(
      accepts(req, { language: 'en', forced: null, hi: null, embedded: false, format: 'srt' }),
    ).toContain('forced flag mismatch or unknown')
  })
})

describe('evaluate', () => {
  it('reports disabled, unknown, missing, satisfied', () => {
    expect(evaluate(req, profile({ automatic: false }), [], true, true, 0).state).toBe('disabled')
    expect(evaluate(req, profile(), [], true, false, 0).state).toBe('disabled')
    expect(evaluate(req, profile(), [], false, true, 0).state).toBe('unknown')
    expect(evaluate(req, profile(), [], true, true, 0).state).toBe('missing')
    expect(evaluate(req, profile(), [row()], true, true, 0).state).toBe('satisfied')
  })
  it('upgrades only managed, unprotected, below-cutoff subtitles inside the window', () => {
    const p = profile({ upgrades: true })
    expect(evaluate(req, p, [row()], true, true, 2000).state).toBe('upgradeable')
    expect(evaluate(req, p, [row({ protected: true })], true, true, 2000).state).toBe('satisfied')
    expect(evaluate(req, p, [row({ managed: false })], true, true, 2000).state).toBe('satisfied')
    expect(evaluate(req, p, [row({ score: 95 })], true, true, 2000).state).toBe('satisfied')
    expect(evaluate(req, p, [row()], true, true, 1000 + 31 * 86_400_000).state).toBe('satisfied')
  })
})

describe('OpenSubtitles parser', () => {
  it('maps results and rejects malformed responses', () => {
    const data = {
      data: [
        {
          id: '9',
          attributes: {
            language: 'en',
            release: 'R',
            moviehash_match: true,
            hearing_impaired: false,
            foreign_parts_only: false,
            feature_details: { imdb_id: 1, year: 2020 },
            files: [{ file_id: 5, file_name: 'a.srt' }],
          },
        },
      ],
    }
    const [c] = openSubtitles(data, 'os', movie)
    expect(c).toMatchObject({
      id: '9:5',
      fileId: '5',
      language: 'en',
      hashMatch: true,
      ids: { imdb: 'tt1' },
    })
    expect(() => openSubtitles({}, 'os', movie)).toThrow(/invalid/)
  })
})
