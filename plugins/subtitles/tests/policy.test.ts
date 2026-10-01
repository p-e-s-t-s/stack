import type { SubtitleCandidate, SubtitleRequirement, SubtitleSearchContext } from '@magpiejs/types'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, accepts, evaluate, scoreCandidate, validateProfile } from '../src/policy'
import type { Inventory, Profile } from '../src/schema'

const req = (over: Partial<SubtitleRequirement> = {}): SubtitleRequirement => ({
  id: 'en',
  language: 'en',
  forced: 'either',
  hi: 'either',
  embedded: false,
  formats: ['srt'],
  minimum: 0,
  cutoff: 80,
  ...over,
})

describe('validateProfile', () => {
  const valid = () => ({ name: ' English ', requirements: [req({ language: 'eng' })] })

  it('normalises the name, language and policy defaults', () => {
    const profile = validateProfile(valid())
    expect(profile.name).toBe('English')
    expect(profile.requirements[0]?.language).toBe('en')
    expect(profile.policy).toEqual(DEFAULT_POLICY)
  })

  it('removes duplicate formats and keeps overridden policy values', () => {
    const profile = validateProfile({
      ...valid(),
      requirements: [req({ formats: ['srt', 'srt', 'ass'] })],
      policy: { automatic: true, sync: 'required' },
    })
    expect(profile.requirements[0]?.formats).toEqual(['srt', 'ass'])
    expect(profile.policy).toMatchObject({ automatic: true, sync: 'required', monitoredOnly: true })
  })

  it.each([
    ['no input', null, 'profile name is required'],
    ['a blank name', { ...valid(), name: '  ' }, 'profile name is required'],
    [
      'a name over 100 characters',
      { ...valid(), name: 'x'.repeat(101) },
      'profile name is required',
    ],
    ['no requirements', { ...valid(), requirements: [] }, 'choose 1–30'],
    [
      'over 30 requirements',
      { ...valid(), requirements: Array.from({ length: 31 }, (_, i) => req({ id: `r${i}` })) },
      'choose 1–30',
    ],
    [
      'an unknown language',
      { ...valid(), requirements: [req({ language: 'zzzz' })] },
      'valid languages',
    ],
    ['an invalid id', { ...valid(), requirements: [req({ id: 'has space' })] }, 'valid languages'],
    [
      'duplicate ids',
      { ...valid(), requirements: [req(), req({ forced: 'forced' })] },
      'unique IDs',
    ],
    [
      'a bad forced flag',
      { ...valid(), requirements: [req({ forced: 'maybe' as never })] },
      'invalid subtitle flags',
    ],
    ['no formats', { ...valid(), requirements: [req({ formats: [] })] }, 'supported text formats'],
    [
      'an unsupported format',
      { ...valid(), requirements: [req({ formats: ['pgs' as never] })] },
      'supported text formats',
    ],
    [
      'a cutoff below the minimum',
      { ...valid(), requirements: [req({ minimum: 60, cutoff: 50 })] },
      'cutoff must be at least minimum',
    ],
    [
      'a score over 100',
      { ...valid(), requirements: [req({ cutoff: 101 })] },
      'scores must be 0–100',
    ],
    [
      'the same rule twice',
      { ...valid(), requirements: [req({ id: 'a' }), req({ id: 'b' })] },
      'duplicate language requirement',
    ],
    [
      'an unknown sync mode',
      { ...valid(), policy: { sync: 'sometimes' } },
      'invalid profile policy',
    ],
    [
      'a non-boolean policy flag',
      { ...valid(), policy: { automatic: 'yes' } },
      'invalid profile policy',
    ],
    [
      'an upgrade window over a year',
      { ...valid(), policy: { upgradeDays: 366 } },
      'upgrade window',
    ],
    ['an upgrade delta of zero', { ...valid(), policy: { upgradeDelta: 0 } }, 'upgrade window'],
  ])('rejects %s', (_why, input, message) => {
    expect(() => validateProfile(input)).toThrow(message)
  })

  it('allows the same language twice when the forced or hearing-impaired rule differs', () => {
    const profile = validateProfile({
      ...valid(),
      requirements: [
        req({ id: 'a' }),
        req({ id: 'b', forced: 'forced' }),
        req({ id: 'c', hi: 'require' }),
      ],
    })
    expect(profile.requirements).toHaveLength(3)
  })
})

describe('accepts', () => {
  const sub = (
    over: Partial<Pick<Inventory, 'language' | 'forced' | 'hi' | 'embedded' | 'format'>> = {},
  ) => ({
    language: 'en',
    forced: false,
    hi: false,
    embedded: false,
    format: 'srt',
    ...over,
  })

  it('accepts a matching subtitle, including languages written differently', () => {
    expect(accepts(req(), sub())).toEqual([])
    expect(accepts(req(), sub({ language: 'eng' }))).toEqual([])
  })

  it('reports each way a subtitle can fail', () => {
    expect(accepts(req(), sub({ language: 'fr' }))).toContain('language mismatch or unknown')
    expect(accepts(req(), sub({ language: null }))).toContain('language mismatch or unknown')
    expect(accepts(req({ forced: 'forced' }), sub())).toContain('forced flag mismatch or unknown')
    expect(accepts(req({ forced: 'full' }), sub({ forced: true }))).toContain(
      'forced flag mismatch or unknown',
    )
    expect(accepts(req({ forced: 'full' }), sub({ forced: null }))).toContain(
      'forced flag mismatch or unknown',
    )
    expect(accepts(req({ hi: 'require' }), sub())).toContain('hearing-impaired required')
    expect(accepts(req({ hi: 'exclude' }), sub({ hi: true }))).toContain(
      'hearing-impaired excluded or unknown',
    )
    expect(accepts(req({ hi: 'exclude' }), sub({ hi: null }))).toContain(
      'hearing-impaired excluded or unknown',
    )
    expect(accepts(req(), sub({ format: 'ass' }))).toContain('format or embedded track excluded')
  })

  it('treats "prefer" and "either" as always acceptable', () => {
    expect(accepts(req({ hi: 'prefer' }), sub({ hi: true }))).toEqual([])
    expect(accepts(req({ hi: 'prefer' }), sub({ hi: null }))).toEqual([])
  })

  it('accepts embedded tracks only when the requirement allows them', () => {
    expect(accepts(req(), sub({ embedded: true, format: 'subrip' }))).toContain(
      'format or embedded track excluded',
    )
    expect(accepts(req({ embedded: true }), sub({ embedded: true, format: 'subrip' }))).toEqual([])
  })
})

describe('scoreCandidate', () => {
  const query = (over: Partial<SubtitleSearchContext> = {}): SubtitleSearchContext => ({
    kind: 'movie',
    title: 'Dune',
    year: 2021,
    ids: { imdb: 'tt1' },
    releaseName: 'Dune.2021.1080p.BluRay-GRP.mkv',
    releaseGroup: 'GRP',
    size: 1,
    episodes: [],
    ...over,
  })
  const candidate = (over: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({
    id: 'c',
    providerId: 'p',
    fileId: 'f',
    name: 'n',
    language: 'en',
    forced: false,
    hi: false,
    format: 'srt',
    ids: {},
    ...over,
  })

  it('scores a file-hash match 100 even without an identity match', () => {
    const r = scoreCandidate(candidate({ hashMatch: true }), query(), req())
    expect(r.score).toBe(100)
    expect(r.reasons).toEqual([])
    expect(r.evidence).toEqual(['scoring:v1', 'file hash'])
  })

  it('scores identity plus exact release 90, plus release group 80, identity alone 60', () => {
    const id = { imdb: 'tt1' }
    expect(
      scoreCandidate(
        candidate({ ids: id, releaseName: 'dune 2021 1080p bluray-grp.srt' }),
        query(),
        req(),
      ).score,
    ).toBe(90)
    expect(
      scoreCandidate(candidate({ ids: id, releaseName: 'Other.Cut-grp' }), query(), req()).score,
    ).toBe(80)
    expect(scoreCandidate(candidate({ ids: id }), query(), req()).score).toBe(60)
  })

  it('leaves candidates without any verified identity at 0, for manual selection only', () => {
    const r = scoreCandidate(candidate(), query(), req())
    expect(r.score).toBe(0)
    expect(r.reasons).toContain('identity unverified; manual selection only')
  })

  it('rejects identity and year conflicts', () => {
    expect(scoreCandidate(candidate({ ids: { imdb: 'tt2' } }), query(), req()).reasons).toContain(
      'imdb identity conflict',
    )
    expect(
      scoreCandidate(candidate({ ids: { imdb: 'tt1' }, year: 1984 }), query(), req()).reasons,
    ).toContain('year conflict')
  })

  it('rejects candidates below the requirement’s minimum score', () => {
    const r = scoreCandidate(
      candidate({ ids: { imdb: 'tt1' } }),
      query(),
      req({ minimum: 70, cutoff: 80 }),
    )
    expect(r.reasons).toContain('score 60 below minimum 70')
  })

  it('includes the requirement’s own rejections (wrong language, format)', () => {
    const r = scoreCandidate(
      candidate({ ids: { imdb: 'tt1' }, language: 'fr', format: 'ass' }),
      query(),
      req(),
    )
    expect(r.reasons).toEqual(
      expect.arrayContaining(['language mismatch or unknown', 'format or embedded track excluded']),
    )
  })

  describe('for series', () => {
    const series = (episodes: { season: number; number: number }[]) =>
      query({ kind: 'series', year: null, episodes })
    const ids = { imdb: 'tt1' }

    it('needs the candidate to cover exactly the same episodes', () => {
      const ep = (n: number) => ({ season: 1, number: n })
      expect(
        scoreCandidate(candidate({ ids, episodes: [ep(1)] }), series([ep(1)]), req()).evidence,
      ).toContain('episode coverage')
      for (const episodes of [undefined, [], [ep(2)], [ep(1), ep(2)]])
        expect(
          scoreCandidate(candidate({ ids, episodes }), series([ep(1)]), req()).reasons,
        ).toContain('episode coverage missing or conflicting')
      // a multi-episode file needs every episode covered
      expect(
        scoreCandidate(candidate({ ids, episodes: [ep(2), ep(1)] }), series([ep(1), ep(2)]), req())
          .reasons,
      ).toEqual([])
    })

    it('rejects everything when the episodes are unknown', () => {
      expect(
        scoreCandidate(candidate({ ids, episodes: [{ season: 1, number: 1 }] }), series([]), req())
          .reasons,
      ).toContain('episode coverage missing or conflicting')
    })
  })
})

describe('evaluate', () => {
  const NOW = 10 * 86_400_000
  const profile = (policy: Partial<Profile['policy']> = {}): Profile =>
    ({
      id: 1,
      name: 'p',
      requirements: [],
      policy: { ...DEFAULT_POLICY, automatic: true, ...policy },
      revision: 1,
    }) as never
  const row = (over: Partial<Inventory> = {}): Inventory =>
    ({
      language: 'en',
      forced: false,
      hi: false,
      embedded: false,
      format: 'srt',
      present: true,
      valid: true,
      managed: false,
      protected: false,
      score: null,
      acquiredAt: null,
      ...over,
    }) as never
  const run = (rows: Inventory[], p = profile(), known = true, monitored = true, r = req()) =>
    evaluate(r, p, rows, known, monitored, NOW)

  it('is disabled without automatic acquisition, or for unmonitored files when monitoredOnly', () => {
    expect(run([], profile({ automatic: false }))).toMatchObject({
      state: 'disabled',
      reason: 'automatic acquisition disabled',
    })
    expect(run([], profile(), true, false)).toMatchObject({
      state: 'disabled',
      reason: 'file is unmonitored',
    })
    expect(run([], profile({ monitoredOnly: false }), true, false).state).toBe('missing')
  })

  it('is unknown until the inventory is complete', () => {
    expect(run([], profile(), false).state).toBe('unknown')
  })

  it('is missing when nothing acceptable is present, valid and present', () => {
    expect(run([]).state).toBe('missing')
    expect(
      run([row({ present: false }), row({ valid: false }), row({ language: 'fr' })]).state,
    ).toBe('missing')
  })

  it('is satisfied by an acceptable subtitle, preferring the highest score', () => {
    const better = row({ score: 90 })
    const result = run([row({ score: 60 }), better])
    expect(result.state).toBe('satisfied')
    expect(result.current).toBe(better)
  })

  describe('upgrades', () => {
    const upgrading = profile({ upgrades: true, upgradeDays: 30 })
    const managed = (over: Partial<Inventory> = {}) =>
      row({ managed: true, score: 60, acquiredAt: NOW - 86_400_000, ...over })

    it('flags a managed subtitle below the cutoff within the upgrade window', () => {
      expect(run([managed()], upgrading)).toMatchObject({
        state: 'upgradeable',
        reason: 'score 60 below cutoff 80',
      })
    })

    it.each([
      ['it is at or above the cutoff', managed({ score: 80 })],
      ['it was added outside the window', managed({ acquiredAt: NOW - 31 * 86_400_000 })],
      ['the user protected it', managed({ protected: true })],
      ['Magpie did not install it', managed({ managed: false })],
      ['its score is unknown', managed({ score: null })],
    ])('is satisfied when %s', (_why, current) => {
      expect(run([current], upgrading).state).toBe('satisfied')
    })

    it('is satisfied when upgrades are off', () => {
      expect(run([managed()]).state).toBe('satisfied')
    })
  })
})
