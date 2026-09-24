// Web console entry for the decision plugin: Parse tester, profiles and custom formats.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { BaseParsed } from './families'
import { formatMatches, GENERIC_CONDITIONS } from './formats'
import type { Decision, DecisionService } from './index'
import type { DecisionTarget } from './rules'
import type * as schema from './schema'

export interface TestResult {
  /** A `ParsedRelease` for video; other families have their own fields. */
  parsed: BaseParsed & { spans?: { field: string; start: number; end: number }[] }
  decision?: Omit<Decision, 'parsed'>
}

export interface FamilyInfo {
  id: string
  label: string
  sizeRule: 'perMinute' | 'total' | 'none'
  qualities: { id: string; name: string }[]
}

export interface ConditionInfo {
  type: string
  label: string
  values?: string[]
  /** Set for conditions only one family understands. */
  family?: string
}

export interface DecisionData {
  families: FamilyInfo[]
  /** Every quality of every family. */
  qualities: { id: string; name: string }[]
  conditions: ConditionInfo[]
  profiles: schema.Profile[]
  formats: schema.CustomFormat[]
  scores: Record<number, Record<number, number>>
  sizes: schema.QualitySize[]
  restrictions: schema.Restriction[]
  /** Parses names with a family (the profile's, when one is given) and decides on them. */
  test(
    names: string[],
    profileId?: number,
    current?: DecisionTarget['current'],
    runtimeMinutes?: number,
    family?: string,
  ): Promise<TestResult[]>
  saveProfile(profile: schema.Profile | Omit<schema.Profile, 'id'>): Promise<number>
  deleteProfile(id: number): Promise<void>
  /** Whether a format matches a release name, using the family its conditions belong to. */
  testFormat(format: Pick<schema.CustomFormat, 'conditions'>, title: string): Promise<boolean>
  saveFormat(format: schema.CustomFormat | Omit<schema.CustomFormat, 'id'>): Promise<number>
  deleteFormat(id: number): Promise<void>
  setScore(profileId: number, formatId: number, score: number): Promise<void>
  saveSize(size: schema.QualitySize): Promise<void>
  saveRestriction(restriction: schema.Restriction | Omit<schema.Restriction, 'id'>): Promise<number>
  deleteRestriction(id: number): Promise<void>
}

export default function console_(ctx: Context, decision: DecisionService) {
  const snapshot = () => {
    const profiles = decision.profiles()
    const families = decision.families()
    return {
      families: families.map(({ id, label, sizeRule, qualities }) => ({
        id,
        label,
        sizeRule,
        qualities,
      })),
      qualities: families.flatMap((f) => f.qualities),
      conditions: [
        ...Object.entries(GENERIC_CONDITIONS).map(([type, c]) => ({ type, label: c.label })),
        ...families.flatMap((f) =>
          Object.entries(f.conditions ?? {}).map(([type, c]) => ({
            type,
            label: c.label,
            values: c.values,
            family: f.id,
          })),
        ),
      ],
      profiles,
      formats: decision.formats(),
      scores: Object.fromEntries(profiles.map((p) => [p.id, decision.scores(p.id)])),
      sizes: decision.sizes(),
      restrictions: decision.restrictions(),
    }
  }

  // every change goes through here so open consoles update live
  const change = async <T>(fn: () => T) => {
    const result = fn()
    const next = snapshot()
    entry.mutate((data) => Object.assign(data, next))
    return result
  }

  ctx.on('decision/families', () => entry.mutate((data) => Object.assign(data, snapshot())))

  const data: DecisionData = {
    ...snapshot(),
    async test(names, profileId, current, runtimeMinutes, familyId) {
      const profile = profileId ? decision.profile(profileId) : undefined
      const family = profile
        ? decision.familyOf(profile)
        : (decision.families().find((f) => f.id === familyId) ?? decision.families()[0]!)
      const evaluate = profile
        ? decision.evaluator({ kind: 'movie', profileId: profile.id, current, runtimeMinutes })
        : undefined
      return names
        .map((n) => n.trim())
        .filter(Boolean)
        .slice(0, 200)
        .map((title) => {
          const parsed = family.parse(title)
          if (!evaluate) return { parsed }
          // the tester doesn't know the target, so episode matching is skipped
          const target = parsed.kind === 'movie' || parsed.kind === 'unknown' ? undefined : 'series'
          const { parsed: _, ...rest } = evaluate({
            info: { guid: title, title, protocol: 'torrent', indexerId: 'tester', downloadUrl: '' },
            parsed,
          })
          if (target) rest.rejections = rest.rejections.filter((r) => r.rule !== 'episode-match')
          rest.accepted = !rest.rejections.length
          return { parsed, decision: rest }
        })
    },
    saveProfile: (profile) => change(() => decision.saveProfile(profile)),
    deleteProfile: (id) => change(() => decision.deleteProfile(id)),
    async testFormat(format, title) {
      const families = decision.families()
      const family =
        families.find((f) => format.conditions.some((c) => c.type in (f.conditions ?? {}))) ??
        families[0]!
      return formatMatches(
        format,
        { parsed: family.parse(title), info: { title } },
        family.conditions,
      )
    },
    saveFormat: (format) => change(() => decision.saveFormat(format)),
    deleteFormat: (id) => change(() => decision.deleteFormat(id)),
    setScore: (profileId, formatId, score) =>
      change(() => decision.setScore(profileId, formatId, score)),
    saveSize: (size) => change(() => decision.saveSize(size)),
    saveRestriction: (restriction) => change(() => decision.saveRestriction(restriction)),
    deleteRestriction: (id) => change(() => decision.deleteRestriction(id)),
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/system/parse', '/settings/profiles', '/settings/formats'],
    },
    data,
  )
}
