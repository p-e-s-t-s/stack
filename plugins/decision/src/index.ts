// @magpiejs/decision: qualities, profiles, custom formats and release decisions
// (docs/phase-2.md §3).

import type { Drizzle } from '@magpiejs/database'
import { type ParsedRelease, parse } from '@magpiejs/parser'
import type { ReleaseInfo } from '@magpiejs/types'
import type BetterSqlite3 from 'better-sqlite3'
import { type Context, Service } from 'cordis'
import { and, eq } from 'drizzle-orm'
import { formatMatches } from './formats'
import { QUALITIES, type Quality, qualityOf } from './qualities'
import {
  BUILTIN_RULES,
  type DecisionTarget,
  type Rejection,
  type Rule,
  type RuleContext,
} from './rules'
import * as schema from './schema'
import console_ from './console'

export * from './formats'
export * from './qualities'
export * from './rules'
export * from './schema'

declare module 'cordis' {
  interface Context {
    decision: DecisionService
  }
}

export interface Decision {
  accepted: boolean
  quality: Quality
  formatScore: number
  matchedFormats: string[]
  rejections: { rule: string; reason: string; permanent: boolean }[]
  /** Higher is better; compare element by element (see `compareDecisions`). */
  rank: number[]
  parsed: ParsedRelease
}

export interface Candidate {
  info: ReleaseInfo & { flags?: string[] }
  parsed?: ParsedRelease
}

/** Sort comparator: best decision first. */
export function compareDecisions(a: Decision, b: Decision) {
  for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i++) {
    const d = (b.rank[i] ?? 0) - (a.rank[i] ?? 0)
    if (d) return d
  }
  return 0
}

export class DecisionService extends Service {
  static inject = ['database']

  db!: Drizzle<typeof schema>
  private rules = new Map<string, Rule>()

  constructor(ctx: Context) {
    super(ctx, 'decision')
  }

  *[Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'decision',
      schema,
      migrations: new URL('../migrations', import.meta.url),
      steps: { '0000_init': seedDefaults },
    })
    for (const [name, rule] of Object.entries(BUILTIN_RULES)) this.rules.set(name, rule)
    // web console pages, only when the web console is loaded
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    yield () => this.rules.clear()
  }

  /** Adds a rule for the lifetime of the calling plugin (e.g. `blocklist` from downloads). */
  rule(name: string, rule: Rule) {
    return this.ctx.effect(() => {
      if (this.rules.has(name)) throw new Error(`decision rule ${name} already exists`)
      this.rules.set(name, rule)
      return () => this.rules.delete(name)
    }, `decision.rule(${name})`)
  }

  // ---- settings

  profiles() {
    return this.db.select().from(schema.profiles).all()
  }

  profile(id: number) {
    return this.db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get()
  }

  saveProfile(profile: Omit<schema.Profile, 'id'> & { id?: number }) {
    const { id, ...values } = profile
    if (id) {
      this.db.update(schema.profiles).set(values).where(eq(schema.profiles.id, id)).run()
      return id
    }
    return this.db
      .insert(schema.profiles)
      .values(values)
      .returning({ id: schema.profiles.id })
      .get().id
  }

  deleteProfile(id: number) {
    this.db.delete(schema.profiles).where(eq(schema.profiles.id, id)).run()
  }

  formats() {
    return this.db.select().from(schema.customFormats).all()
  }

  saveFormat(format: Omit<schema.CustomFormat, 'id'> & { id?: number }) {
    const { id, ...values } = format
    if (id) {
      this.db.update(schema.customFormats).set(values).where(eq(schema.customFormats.id, id)).run()
      return id
    }
    return this.db
      .insert(schema.customFormats)
      .values(values)
      .returning({ id: schema.customFormats.id })
      .get().id
  }

  deleteFormat(id: number) {
    this.db.delete(schema.customFormats).where(eq(schema.customFormats.id, id)).run()
  }

  scores(profileId: number): Record<number, number> {
    const rows = this.db
      .select()
      .from(schema.profileScores)
      .where(eq(schema.profileScores.profileId, profileId))
      .all()
    return Object.fromEntries(rows.map((r) => [r.formatId, r.score]))
  }

  setScore(profileId: number, formatId: number, score: number) {
    if (!score) {
      this.db
        .delete(schema.profileScores)
        .where(
          and(
            eq(schema.profileScores.profileId, profileId),
            eq(schema.profileScores.formatId, formatId),
          ),
        )
        .run()
      return
    }
    this.db
      .insert(schema.profileScores)
      .values({ profileId, formatId, score })
      .onConflictDoUpdate({
        target: [schema.profileScores.profileId, schema.profileScores.formatId],
        set: { score },
      })
      .run()
  }

  sizes() {
    return this.db.select().from(schema.qualitySizes).all()
  }

  saveSize(size: schema.QualitySize) {
    this.db
      .insert(schema.qualitySizes)
      .values(size)
      .onConflictDoUpdate({ target: schema.qualitySizes.quality, set: size })
      .run()
  }

  restrictions() {
    return this.db.select().from(schema.restrictions).all()
  }

  saveRestriction(restriction: Omit<schema.Restriction, 'id'> & { id?: number }) {
    const { id, ...values } = restriction
    if (id) {
      this.db.update(schema.restrictions).set(values).where(eq(schema.restrictions.id, id)).run()
      return id
    }
    return this.db
      .insert(schema.restrictions)
      .values(values)
      .returning({ id: schema.restrictions.id })
      .get().id
  }

  deleteRestriction(id: number) {
    this.db.delete(schema.restrictions).where(eq(schema.restrictions.id, id)).run()
  }

  // ---- decisions

  /** Decides on many releases for one target; best first. */
  evaluateAll(candidates: Candidate[], target: DecisionTarget, now = Date.now()) {
    const evaluate = this.evaluator(target, now)
    return candidates.map(evaluate).sort(compareDecisions)
  }

  evaluate(candidate: Candidate, target: DecisionTarget, now = Date.now()) {
    return this.evaluator(target, now)(candidate)
  }

  /** Loads the profile, formats and settings once and returns a function per release. */
  evaluator(target: DecisionTarget, now = Date.now()) {
    const profile = this.profile(target.profileId)
    if (!profile) throw new Error(`quality profile ${target.profileId} not found`)
    const scores = this.scores(profile.id)
    const formats = this.formats().filter((f) => scores[f.id])
    const sizes = new Map(this.sizes().map((s) => [s.quality, s]))
    const restrictions = this.restrictions()
    const { rankOf, allowed } = profileRanks(profile)
    const cutoffRank =
      rankOf(profile.cutoff) >= 0 ? rankOf(profile.cutoff) : groupRank(profile, profile.cutoff)
    const rules = [...this.rules]

    return (candidate: Candidate): Decision => {
      const parsed = candidate.parsed ?? parse(candidate.info.title)
      const quality = qualityOf(parsed)
      const input = { parsed, info: candidate.info, originalLanguage: target.originalLanguage }
      const matched = formats.filter((f) => formatMatches(f, input))
      const formatScore = matched.reduce((sum, f) => sum + scores[f.id]!, 0)
      const context: RuleContext = {
        info: candidate.info,
        parsed,
        target,
        profile,
        quality,
        qualityRank: rankOf(quality),
        qualityAllowed: allowed.has(quality),
        formatScore,
        size: sizes.get(quality),
        restrictions,
        rankOf,
        cutoffRank,
        now,
      }
      const rejections: Decision['rejections'] = []
      for (const [name, rule] of rules) {
        const result = rule(context)
        if (!result) continue
        const rejection: Rejection = typeof result === 'string' ? { reason: result } : result
        rejections.push({ rule: name, reason: rejection.reason, permanent: !!rejection.permanent })
      }
      const info = candidate.info
      return {
        accepted: !rejections.length,
        quality,
        formatScore,
        matchedFormats: matched.map((f) => f.name),
        rejections,
        parsed,
        rank: [
          context.qualityRank,
          formatScore,
          parsed.revision.version,
          parsed.revision.real,
          info.protocol === 'torrent'
            ? (info.seeders ?? 0)
            : -(info.publishedAt ? now - Date.parse(info.publishedAt) : 0),
        ],
      }
    }
  }
}

/** Rank of each quality in a profile: position of its item; qualities in a group share one. */
export function profileRanks(profile: Pick<schema.Profile, 'items'>) {
  const ranks = new Map<string, number>()
  const allowed = new Set<string>()
  profile.items.forEach((item, index) => {
    const qualities = 'quality' in item ? [item.quality] : item.qualities
    for (const q of qualities) {
      ranks.set(q, index)
      if (item.allowed) allowed.add(q)
    }
  })
  return { rankOf: (quality: string) => ranks.get(quality) ?? -1, allowed }
}

/** Whether a file already satisfies the profile's cutoff (no more upgrades wanted). */
export function cutoffMet(profile: schema.Profile, file: { quality: string; formatScore: number }) {
  if (!profile.upgradesAllowed) return true
  const { rankOf } = profileRanks(profile)
  const cutoff =
    rankOf(profile.cutoff) >= 0 ? rankOf(profile.cutoff) : groupRank(profile, profile.cutoff)
  return rankOf(file.quality) >= cutoff && file.formatScore >= profile.cutoffFormatScore
}

function groupRank(profile: schema.Profile, name: string) {
  return profile.items.findIndex((item) => 'name' in item && item.name === name)
}

// ---- defaults, written by the first migration

const MIN_SIZE: Partial<Record<Quality, number>> = {
  'webdl-480p': 1,
  'webrip-480p': 1,
  'bluray-480p': 1,
  'hdtv-720p': 3,
  'webrip-720p': 3,
  'webdl-720p': 3,
  'bluray-720p': 4,
  'hdtv-1080p': 5,
  'webrip-1080p': 5,
  'webdl-1080p': 5,
  'bluray-1080p': 7,
  'remux-1080p': 15,
  'hdtv-2160p': 15,
  'webrip-2160p': 15,
  'webdl-2160p': 15,
  'bluray-2160p': 20,
  'remux-2160p': 35,
}

function items(allowed: Quality[], groups: { name: string; qualities: Quality[] }[] = []) {
  const result: schema.ProfileItem[] = []
  for (const quality of QUALITIES) {
    const group = groups.find((g) => g.qualities.includes(quality))
    if (group) {
      if (group.qualities[0] === quality) {
        result.push({
          name: group.name,
          qualities: group.qualities,
          allowed: group.qualities.some((q) => allowed.includes(q)),
        })
      }
      continue
    }
    result.push({ quality, allowed: allowed.includes(quality) })
  }
  return result
}

const WEB_GROUPS = [
  { name: 'WEB 720p', qualities: ['webrip-720p', 'webdl-720p'] as Quality[] },
  { name: 'WEB 1080p', qualities: ['webrip-1080p', 'webdl-1080p'] as Quality[] },
  { name: 'WEB 2160p', qualities: ['webrip-2160p', 'webdl-2160p'] as Quality[] },
]

export const DEFAULT_PROFILES = [
  {
    name: 'Any',
    items: items(
      QUALITIES.filter((q) => q !== 'unknown'),
      WEB_GROUPS,
    ),
    cutoff: 'WEB 1080p',
  },
  {
    name: 'HD',
    items: items(
      [
        'hdtv-720p',
        'webrip-720p',
        'webdl-720p',
        'bluray-720p',
        'hdtv-1080p',
        'webrip-1080p',
        'webdl-1080p',
        'bluray-1080p',
      ],
      WEB_GROUPS,
    ),
    cutoff: 'bluray-1080p',
  },
  {
    name: 'Ultra HD',
    items: items(
      ['hdtv-2160p', 'webrip-2160p', 'webdl-2160p', 'bluray-2160p', 'remux-2160p'],
      WEB_GROUPS,
    ),
    cutoff: 'remux-2160p',
  },
]

function seedDefaults(db: BetterSqlite3.Database) {
  const size = db.prepare('INSERT INTO decision_quality_sizes (quality, min) VALUES (?, ?)')
  for (const quality of QUALITIES) size.run(quality, MIN_SIZE[quality] ?? 0)
  const profile = db.prepare(
    'INSERT INTO decision_profiles (name, items, cutoff, languages) VALUES (?, ?, ?, ?)',
  )
  for (const p of DEFAULT_PROFILES)
    profile.run(p.name, JSON.stringify(p.items), p.cutoff, JSON.stringify(['en']))
}

export default DecisionService
