// @magpiejs/decision: qualities, profiles, custom formats and release decisions
// (docs/phase-2.md §3).

import type { Drizzle } from '@magpiejs/database'
import type { ReleaseInfo } from '@magpiejs/types'
import type BetterSqlite3 from 'better-sqlite3'
import { type Context, Service } from 'cordis'
import { and, eq } from 'drizzle-orm'
import { type BaseParsed, type QualityFamily, VIDEO_PROFILES, videoFamily } from './families'
import { formatMatches } from './formats'
import {
  BUILTIN_RULES,
  type DecisionTarget,
  type Rejection,
  type Rule,
  type RuleContext,
} from './rules'
import * as schema from './schema'
import console_ from './console'

export * from './families'
export * from './formats'
export * from './qualities'
export * from './rules'
export * from './schema'

declare module 'cordis' {
  interface Context {
    decision: DecisionService
  }
  interface Events {
    'decision/families'(): void
  }
}

export interface Decision {
  accepted: boolean
  /** A quality id of the profile's family. */
  quality: string
  formatScore: number
  matchedFormats: string[]
  rejections: { rule: string; reason: string; permanent: boolean }[]
  /** Higher is better; compare element by element (see `compareDecisions`). */
  rank: number[]
  /** The family's parse of the release name (a `ParsedRelease` for video). */
  parsed: BaseParsed
}

export interface Candidate {
  info: ReleaseInfo & { flags?: string[] }
  parsed?: BaseParsed
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
  private familyMap = new Map<string, QualityFamily>([['video', videoFamily as QualityFamily]])

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
    // web console pages, only when the web console is loaded
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    yield () => this.rules.clear()
  }

  // ---- quality families

  /**
   * Adds a quality family for the lifetime of the calling plugin. The first time a family is
   * seen, its default sizes and profiles are created.
   */
  family<P extends BaseParsed>(definition: QualityFamily<P>) {
    return this.ctx.effect(() => {
      if (this.familyMap.has(definition.id))
        throw new Error(`quality family ${definition.id} already exists`)
      const taken = new Set(this.families().flatMap((f) => f.qualities.map((q) => q.id)))
      const clash = definition.qualities.find((q) => taken.has(q.id))
      if (clash) throw new Error(`quality ${clash.id} already belongs to another family`)
      this.familyMap.set(definition.id, definition as unknown as QualityFamily)
      this.seed(definition as unknown as QualityFamily)
      this.ctx.emit('decision/families')
      return () => {
        this.familyMap.delete(definition.id)
        this.ctx.emit('decision/families')
      }
    }, `decision.family(${definition.id})`)
  }

  families(): QualityFamily[] {
    return [...this.familyMap.values()]
  }

  familyOf(profile: Pick<schema.Profile, 'family'>) {
    const family = this.familyMap.get(profile.family)
    if (!family) throw new Error(`the ${profile.family} quality family is not loaded`)
    return family
  }

  /** Display name of a quality of any family. */
  qualityName(quality: string) {
    for (const family of this.familyMap.values()) {
      const found = family.qualities.find((q) => q.id === quality)
      if (found) return found.name
    }
    return quality
  }

  /** Default sizes, and default profiles when the family has none yet. */
  private seed(family: QualityFamily) {
    this.db.transaction((tx) => {
      for (const q of family.qualities) {
        tx.insert(schema.qualitySizes)
          .values({ quality: q.id, min: family.defaultSizes?.[q.id] ?? 0 })
          .onConflictDoNothing()
          .run()
      }
      const existing = tx
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.family, family.id))
        .get()
      if (existing) return
      for (const p of family.defaultProfiles) {
        tx.insert(schema.profiles)
          .values({
            name: p.name,
            family: family.id,
            items: p.items,
            cutoff: p.cutoff,
            languages: p.languages ?? [],
          })
          .onConflictDoNothing()
          .run()
      }
    })
  }

  /** Adds a rule for the lifetime of the calling plugin (e.g. `blocklist` from downloads). */
  rule(name: string, rule: Rule) {
    return this.ctx.effect(() => {
      if (this.rules.has(name) || name in BUILTIN_RULES)
        throw new Error(`decision rule ${name} already exists`)
      this.rules.set(name, rule)
      return () => this.rules.delete(name)
    }, `decision.rule(${name})`)
  }

  // ---- settings

  /** Quality profiles, optionally only those of one family. */
  profiles(family?: string) {
    const q = this.db.select().from(schema.profiles)
    return (family ? q.where(eq(schema.profiles.family, family)) : q).all()
  }

  profile(id: number) {
    return this.db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get()
  }

  saveProfile(profile: Omit<schema.Profile, 'id' | 'family'> & { id?: number; family?: string }) {
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
    const family = this.familyOf(profile)
    const scores = this.scores(profile.id)
    const formats = this.formats().filter((f) => scores[f.id])
    const sizes = new Map(this.sizes().map((s) => [s.quality, s]))
    const restrictions = this.restrictions()
    const { rankOf, allowed } = profileRanks(profile)
    const cutoffRank =
      rankOf(profile.cutoff) >= 0 ? rankOf(profile.cutoff) : groupRank(profile, profile.cutoff)
    // generic rules, then the family's, then rules added by other plugins
    const rules: [string, Rule][] = [
      ...Object.entries(BUILTIN_RULES),
      ...Object.entries(family.rules ?? {}),
      ...this.rules,
    ]
    const qualityName = (q: string) => this.qualityName(q)
    const hint = { kind: target.kind === 'movie' ? 'movie' : 'series' }

    return (candidate: Candidate): Decision => {
      const parsed = candidate.parsed ?? family.parse(candidate.info.title, hint)
      const quality = family.qualityOf(parsed)
      const input = { parsed, info: candidate.info, originalLanguage: target.originalLanguage }
      const matched = formats.filter((f) => formatMatches(f, input, family.conditions))
      const formatScore = matched.reduce((sum, f) => sum + scores[f.id]!, 0)
      const context: RuleContext = {
        info: candidate.info,
        parsed,
        target,
        profile,
        family,
        quality,
        qualityName,
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

/** The video family's default profiles (`Any`, `HD`, `Ultra HD`). */
export const DEFAULT_PROFILES = VIDEO_PROFILES

function seedDefaults(db: BetterSqlite3.Database) {
  const size = db.prepare('INSERT INTO decision_quality_sizes (quality, min) VALUES (?, ?)')
  for (const { id } of videoFamily.qualities) size.run(id, videoFamily.defaultSizes?.[id] ?? 0)
  const profile = db.prepare(
    'INSERT INTO decision_profiles (name, items, cutoff, languages) VALUES (?, ?, ?, ?)',
  )
  for (const p of DEFAULT_PROFILES)
    profile.run(p.name, JSON.stringify(p.items), p.cutoff, JSON.stringify(['en']))
}

export default DecisionService
