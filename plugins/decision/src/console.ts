// Web console entry for the decision plugin: Parse tester, profiles and custom formats.

import type {} from '@magpiejs/webui'
import { parse, type ParsedRelease } from '@magpiejs/parser'
import type { Context } from 'cordis'
import type { Decision, DecisionService } from './index'
import { QUALITIES, QUALITY_NAMES } from './qualities'
import type { DecisionTarget } from './rules'
import type * as schema from './schema'

export interface TestResult {
  parsed: ParsedRelease
  decision?: Omit<Decision, 'parsed'>
}

export interface DecisionData {
  qualities: { id: string; name: string }[]
  profiles: schema.Profile[]
  formats: schema.CustomFormat[]
  scores: Record<number, Record<number, number>>
  sizes: schema.QualitySize[]
  restrictions: schema.Restriction[]
  test(
    names: string[],
    profileId?: number,
    current?: DecisionTarget['current'],
    runtimeMinutes?: number,
  ): Promise<TestResult[]>
  saveProfile(profile: schema.Profile | Omit<schema.Profile, 'id'>): Promise<number>
  deleteProfile(id: number): Promise<void>
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
    return {
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

  const data: DecisionData = {
    qualities: QUALITIES.map((id) => ({ id, name: QUALITY_NAMES[id] })),
    ...snapshot(),
    async test(names, profileId, current, runtimeMinutes) {
      const evaluate = profileId
        ? decision.evaluator({ kind: 'movie', profileId, current, runtimeMinutes })
        : undefined
      return names
        .map((n) => n.trim())
        .filter(Boolean)
        .slice(0, 200)
        .map((title) => {
          const parsed = parse(title)
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
