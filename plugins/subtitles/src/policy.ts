import type { SubtitleCandidate, SubtitleRequirement, SubtitleSearchContext } from '@magpiejs/types'
import type { Inventory, Profile, WantedState } from './schema'

export { normalizeLanguage as language } from '@magpiejs/probe'
import { normalizeLanguage as language } from '@magpiejs/probe'
export const DEFAULT_POLICY: Profile['policy'] = {
  automatic: false, monitoredOnly: true, upgrades: false, upgradeDays: 30, upgradeDelta: 5, sync: 'off',
}
export function validateProfile(input: unknown): Pick<Profile, 'name' | 'requirements' | 'policy'> {
  const v = input as Partial<Profile> | null
  if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) throw new Error('profile name is required (maximum 100 characters)')
  if (!Array.isArray(v.requirements) || !v.requirements.length || v.requirements.length > 30) throw new Error('choose 1–30 language requirements')
  const ids = new Set<string>(), rules = new Set<string>()
  const requirements = v.requirements.map(r => {
    const lang = language(r.language)
    if (!lang || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id) || ids.has(r.id)) throw new Error('requirements need unique IDs and valid languages')
    ids.add(r.id)
    if (!['full', 'forced', 'either'].includes(r.forced) || !['require', 'prefer', 'exclude', 'either'].includes(r.hi) || typeof r.embedded !== 'boolean') throw new Error('invalid subtitle flags')
    if (!Array.isArray(r.formats) || !r.formats.length || r.formats.some(f => !['srt', 'ass', 'ssa', 'vtt'].includes(f))) throw new Error('choose supported text formats')
    if (![r.minimum, r.cutoff].every(n => Number.isInteger(n) && n >= 0 && n <= 100) || r.cutoff < r.minimum) throw new Error('scores must be 0–100; cutoff must be at least minimum')
    const key = `${lang}:${r.forced}:${r.hi}`
    if (rules.has(key)) throw new Error('duplicate language requirement')
    rules.add(key)
    return { ...r, language: lang, formats: [...new Set(r.formats)] }
  })
  const policy = { ...DEFAULT_POLICY, ...v.policy }
  if (!['automatic', 'monitoredOnly', 'upgrades'].every(k => typeof policy[k as 'automatic'] === 'boolean') || !['off', 'best-effort', 'required'].includes(policy.sync)) throw new Error('invalid profile policy')
  if (!Number.isInteger(policy.upgradeDays) || policy.upgradeDays < 1 || policy.upgradeDays > 365 || !Number.isInteger(policy.upgradeDelta) || policy.upgradeDelta < 1 || policy.upgradeDelta > 100) throw new Error('invalid upgrade window or delta')
  return { name: v.name.trim(), requirements, policy }
}
export function accepts(r: SubtitleRequirement, s: Pick<Inventory, 'language' | 'forced' | 'hi' | 'embedded' | 'format'>): string[] {
  const errors: string[] = []
  if (language(s.language) !== r.language) errors.push('language mismatch or unknown')
  if (r.forced !== 'either' && s.forced !== (r.forced === 'forced')) errors.push('forced flag mismatch or unknown')
  if (r.hi === 'require' && s.hi !== true) errors.push('hearing-impaired required')
  if (r.hi === 'exclude' && s.hi !== false) errors.push('hearing-impaired excluded or unknown')
  if (s.embedded ? !r.embedded : !r.formats.includes(s.format as never)) errors.push('format or embedded track excluded')
  return errors
}
const normalizedRelease = (s: string) => s.toLowerCase().replace(/\.(mkv|mp4|avi|srt|ass|ssa|vtt)$/i, '').replace(/[^a-z0-9]/g, '')
export function scoreCandidate(c: SubtitleCandidate, q: SubtitleSearchContext, r: SubtitleRequirement) {
  const reasons = accepts(r, { ...c, embedded: false })
  const evidence: string[] = []
  let identity = false
  for (const [key, value] of Object.entries(q.ids)) {
    if (!c.ids[key]) continue
    if (c.ids[key] !== value) reasons.push(`${key} identity conflict`)
    else { identity = true; evidence.push(`${key} identity`) }
  }
  if (q.kind === 'movie' && c.year && q.year && c.year !== q.year) reasons.push('year conflict')
  if (q.kind === 'series') {
    const key = (e: {season: number; number: number}) => `${e.season}:${e.number}`
    if (!q.episodes.length || !c.episodes?.length || q.episodes.length !== c.episodes.length || q.episodes.some(e => !c.episodes!.some(x => key(x) === key(e)))) reasons.push('episode coverage missing or conflicting')
    else evidence.push('episode coverage')
  }
  if (c.hashMatch) evidence.push('file hash')
  const exact = !!q.releaseName && !!c.releaseName && normalizedRelease(q.releaseName) === normalizedRelease(c.releaseName)
  if (exact) evidence.push('exact release')
  const group = !!q.releaseGroup && !!c.releaseName && c.releaseName.toLowerCase().endsWith(`-${q.releaseGroup.toLowerCase()}`)
  if (group) evidence.push('release group')
  const score = c.hashMatch ? 100 : identity ? exact ? 90 : group ? 80 : 60 : 0
  if (!identity && !c.hashMatch) reasons.push('identity unverified; manual selection only')
  if (score < r.minimum) reasons.push(`score ${score} below minimum ${r.minimum}`)
  return { score, evidence: ['scoring:v1', ...evidence], reasons }
}
export function evaluate(r: SubtitleRequirement, p: Profile, rows: Inventory[], known: boolean, monitored: boolean, now: number): { state: WantedState; reason: string; current?: Inventory } {
  if (!p.policy.automatic || (p.policy.monitoredOnly && !monitored)) return { state: 'disabled', reason: !p.policy.automatic ? 'automatic acquisition disabled' : 'file is unmonitored' }
  if (!known) return { state: 'unknown', reason: 'inventory is incomplete; scan required' }
  const matches = rows.filter(s => s.present && s.valid && !accepts(r, s).length).sort((a,b) => (b.score ?? 100) - (a.score ?? 100))
  const current = matches[0]
  if (!current) return { state: 'missing', reason: 'no acceptable subtitle' }
  if (p.policy.upgrades && current.managed && !current.protected && current.score !== null && current.score < r.cutoff && current.acquiredAt !== null && now < current.acquiredAt + p.policy.upgradeDays * 86_400_000) return { state: 'upgradeable', reason: `score ${current.score} below cutoff ${r.cutoff}`, current }
  return { state: 'satisfied', reason: 'acceptable subtitle present', current }
}
