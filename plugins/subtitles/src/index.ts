import { randomUUID } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import type { Drizzle } from '@magpiejs/database'
import type {} from '@magpiejs/jobs'
import type {} from '@magpiejs/media-tools'
import type {} from '@magpiejs/mediainfo'
import { type MediaFile, type MediaItem, mediaFiles } from '@magpiejs/library'
import type {} from '@magpiejs/series'
import { SubtitleProviderError, type SubtitleProvider, type SubtitleSearchContext, type SubtitleCandidate, type SubtitleFormat } from '@magpiejs/types'
import { type Context, Service } from 'cordis'
import { and, eq, ne } from 'drizzle-orm'
import z from 'schemastery'
import { sidecar } from '@magpiejs/sidecars'
import { decode, fileHash, fingerprint, hashBytes, movieHash, run, safePath, shifted, unpack, validateText, MAX_SUBTITLE } from './files'
import { evaluate, scoreCandidate, validateProfile } from './policy'
import * as schema from './schema'
import console_ from './console'
import api from './api'

export * from './schema'
export { language, DEFAULT_POLICY } from './policy'
declare module 'cordis' {
  interface Context { subtitles: SubtitlesService }
  interface Events {
    'subtitles/changed'(): void
    'subtitles/action'(mediaId: number, type: 'subtitle-downloaded' | 'subtitle-upgraded' | 'subtitle-synced' | 'subtitle-failed', detail: Record<string, unknown>): void
  }
}
export interface Config { syncEngine: 'ffsubsync' | 'alass'; syncBinary: string; sweepMinutes: number }
export const Config: z<Partial<Config>, Config> = z.object({
  syncEngine: z.union(['ffsubsync','alass']).default('ffsubsync'),
  syncBinary: z.string().default('').description('Optional sync executable path; empty disables external sync.'),
  sweepMinutes: z.natural().min(1).default(60),
})
export interface SearchRow { token: string; name: string; provider: string; language: string | null; forced: boolean | null; hi: boolean | null; format: string; score: number; evidence: string[]; reasons: string[] }
interface Ticket { candidate: SubtitleCandidate; fileId: number; requirementId: string; profileId: number; revision: number; generation: string; expires: number; score: number; evidence: string[]; reasons: string[] }
export interface FileView { file: MediaFile; title: string; kind: 'movie' | 'series'; profile: schema.Profile | null; inherited: boolean; inventory: schema.Inventory[]; wanted: (typeof schema.wanted.$inferSelect)[]; probeError: string | null }

export class SubtitlesService extends Service {
  static inject = ['database', 'library', 'jobs', 'mediaTools', 'mediainfo']
  static Config = Config
  db!: Drizzle<typeof schema>
  config: Config
  now = () => Date.now()
  private providers = new Map<string, SubtitleProvider>()
  private tickets = new Map<string, Ticket>()
  private locks = new Map<number, Promise<unknown>>()
  private controller = new AbortController()
  constructor(ctx: Context, config: Partial<Config> = {}) { super(ctx, 'subtitles'); this.config = Config(config) }

  async [Service.init]() {
    this.db = this.ctx.database.register({ namespace: 'subtitles', schema, migrations: new URL('../migrations', import.meta.url) })
    const tools = this.db.select().from(schema.settings).where(eq(schema.settings.key,'tools')).get()?.value
    if (tools) {
      this.config.syncEngine = tools.syncEngine
      this.config.syncBinary = tools.syncBinary
      // ffprobe's location used to be saved here; it now lives in Settings → Media tools
      if (tools.ffprobe) void this.ctx.mediaTools.adopt('ffprobe', tools.ffprobe).catch(() => {})
    }
    this.ctx.effect(() => () => { this.controller.abort(); this.tickets.clear() })
    await this.recover()
    this.ctx.jobs.define<{ fileId: number }>('subtitles.scan', async ({ fileId }, { signal }) => { await this.scan(fileId, signal) })
    this.ctx.jobs.define<{ fileId: number; requirementId: string }>('subtitles.search', async (p, { signal }) => { await this.automatic(p.fileId, p.requirementId, signal) }, { maxAttempts: 1 })
    this.ctx.jobs.define<{ token: string; override: boolean }>('subtitles.acquire', async (p, { signal }) => { await this.acquire(p.token, p.override, signal) }, { maxAttempts: 1 })
    this.ctx.jobs.define<{ ticket: Ticket; override: boolean }>('subtitles.acquire-ticket', async (p, { signal }) => { await this.acquireTicket(p.ticket, p.override, signal) }, { maxAttempts: 1 })
    this.ctx.jobs.define<{ inventoryId: number; offset?: number }>('subtitles.sync', async (p, { signal }) => { await this.sync(p.inventoryId, p.offset, signal) }, { maxAttempts: 1 })
    this.ctx.jobs.define('subtitles.sweep', () => this.sweep())
    this.ctx.jobs.define('subtitles.reconcile', () => { for (const item of this.videoItems()) this.queueItem(item.id) })
    this.ctx.jobs.schedule('subtitles.sweep', 'subtitles.sweep', this.config.sweepMinutes * 60_000)
    this.ctx.jobs.schedule('subtitles.reconcile', 'subtitles.reconcile', 86_400_000)
    this.ctx.on('library/file-added', (item, file) => { if (this.isVideo(item)) this.queueScan(file.id) })
    this.ctx.on('library/updated', item => { if (this.isVideo(item)) this.queueItem(item.id) })
    // files that could not be scanned for lack of ffprobe are scanned once it works
    this.ctx.on('media-tools/changed', () => { if (this.ctx.mediaTools.status.ffprobe.ok) for (const item of this.videoItems()) this.queueItem(item.id) })
    this.ctx.on('library/file-removed', () => this.changed())
    this.ctx.on('library/deleted', () => this.changed())
    this.ctx.inject(['series'], ctx => {
      ctx.on('series/episodes', id => this.queueItem(id))
      for (const item of this.videoItems()) if (item.kind === 'series') this.queueItem(item.id)
    })
    // Imports/adoption announce file changes; series identity can arrive a little later.
    this.ctx.inject(['webui'], ctx => void ctx.plugin(console_, this))
    this.ctx.inject(['api'], ctx => void ctx.plugin(api, this))
    for (const item of this.videoItems()) this.queueItem(item.id)
  }
  private changed() { this.ctx.emit('subtitles/changed') }
  saveTools(input: unknown) {
    const v = input as Partial<Config> | null
    if (!v || typeof v.syncBinary !== 'string' || !['ffsubsync','alass'].includes(v.syncEngine ?? '')) throw new Error('invalid media tool settings')
    const value = {syncBinary:v.syncBinary.trim(),syncEngine:v.syncEngine as Config['syncEngine']}
    this.db.insert(schema.settings).values({key:'tools',value}).onConflictDoUpdate({target:schema.settings.key,set:{value}}).run()
    Object.assign(this.config,value)
    for (const item of this.videoItems()) this.queueItem(item.id)
    this.changed()
  }
  private isVideo(item: MediaItem) { return item.kind === 'movie' || item.kind === 'series' }
  private videoItems() { return this.ctx.library.list().filter(i => this.isVideo(i)) }
  private signal(signal?: AbortSignal) { return AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]) }
  private async locked<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(fn)
    this.locks.set(id, task)
    try { return await task } finally { if (this.locks.get(id) === task) this.locks.delete(id) }
  }
  private file(id: number) {
    const file = this.ctx.library.db.select().from(mediaFiles).where(eq(mediaFiles.id, id)).get()
    const item = file && this.ctx.library.get(file.mediaId)
    if (!file || !item || !this.isVideo(item)) throw new Error('video file not found')
    const root = this.ctx.library.folderOf(item)
    return { file, item, root, path: resolve(root, file.path) }
  }
  profiles() { return this.db.select().from(schema.profiles).all() }
  profile(id: number) { return this.db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get() }
  saveProfile(input: unknown, id?: number) {
    const values = validateProfile(input)
    const old = id ? this.profile(id) : undefined
    if (id && !old) throw new Error('profile not found')
    const row = old ? this.db.update(schema.profiles).set({ ...values, revision: old.revision + 1 }).where(eq(schema.profiles.id, old.id)).returning().get()! : this.db.insert(schema.profiles).values(values).returning().get()
    for (const item of this.videoItems()) if (this.effective(item).profile?.id === row.id) this.queueItem(item.id)
    this.changed()
    return row
  }
  removeProfile(id: number) {
    if (this.db.select().from(schema.assignments).where(eq(schema.assignments.profileId, id)).get() || this.db.select().from(schema.defaults).where(eq(schema.defaults.profileId, id)).get()) throw new Error('reassign or disable this profile before deleting it')
    this.db.delete(schema.profiles).where(eq(schema.profiles.id, id)).run(); this.changed()
  }
  kindDefaults() { return this.db.select().from(schema.defaults).all() }
  setDefault(kind: 'movie' | 'series', profileId: number | null) {
    if (!['movie','series'].includes(kind) || (profileId !== null && !this.profile(profileId))) throw new Error('invalid kind or profile')
    this.db.insert(schema.defaults).values({kind, profileId}).onConflictDoUpdate({ target: schema.defaults.kind, set: {profileId} }).run()
    for (const item of this.videoItems()) if (item.kind === kind && this.effective(item).inherited) this.queueItem(item.id)
    this.changed()
  }
  assign(mediaId: number, profileId: number | null | 'inherit') {
    const item = this.ctx.library.get(mediaId)
    if (!item || !this.isVideo(item) || (profileId !== null && profileId !== 'inherit' && !this.profile(profileId))) throw new Error('invalid media item or profile')
    if (profileId === 'inherit') this.db.delete(schema.assignments).where(eq(schema.assignments.mediaId, mediaId)).run()
    else this.db.insert(schema.assignments).values({mediaId, profileId}).onConflictDoUpdate({target: schema.assignments.mediaId, set: {profileId}}).run()
    this.queueItem(mediaId); this.changed()
  }
  effective(item: MediaItem) {
    const assignment = this.db.select().from(schema.assignments).where(eq(schema.assignments.mediaId, item.id)).get()
    const id = assignment ? assignment.profileId : this.db.select().from(schema.defaults).where(eq(schema.defaults.kind, item.kind as 'movie' | 'series')).get()?.profileId
    return { profile: id ? this.profile(id) ?? null : null, inherited: !assignment }
  }
  queueScan(fileId: number) { return this.ctx.jobs.enqueue('subtitles.scan', {fileId}, {dedupeKey: `subtitles:scan:${fileId}`}) }
  queueItem(mediaId: number) { return this.ctx.library.files(mediaId).map(f=>this.queueScan(f.id)) }
  queueAcquire(token: string, override = false) {
    const t = this.ticket(token)
    // Persist the server-issued ticket: a queued acquisition can resume across restart.
    return this.ctx.jobs.enqueue('subtitles.acquire-ticket', {ticket: t, override}, {dedupeKey: `subtitles:acquire:${t.fileId}:${t.requirementId}`})
  }
  queueSync(inventoryId: number, offset?: number) { return this.ctx.jobs.enqueue('subtitles.sync', { inventoryId, offset }, {dedupeKey: `subtitles:sync:${inventoryId}`}) }
  files(mediaId?: number): FileView[] {
    return this.videoItems().filter(i => mediaId === undefined || i.id === mediaId).flatMap(item => this.ctx.library.files(item.id).map(file => ({
      file, title: item.title, kind:item.kind as 'movie'|'series', ...this.effective(item),
      inventory: this.db.select().from(schema.inventory).where(eq(schema.inventory.fileId, file.id)).all(),
      wanted: this.db.select().from(schema.wanted).where(eq(schema.wanted.fileId, file.id)).all(),
      probeError: this.db.select().from(schema.probes).where(eq(schema.probes.fileId, file.id)).get()?.error ?? null,
    })))
  }
  media() { return this.videoItems().map(item=>({id:item.id,title:item.title,kind:item.kind,...this.effective(item)})) }
  async scan(fileId: number, signal?: AbortSignal) {
    return this.locked(fileId, async () => {
      const s = this.signal(signal); s.throwIfAborted()
      let generation = 'unknown'
      try {
        const { path, root, file } = this.file(fileId)
        await safePath(root, path)
        generation = await fingerprint(path)
        // one probe per file version, shared with the rest of Magpie
        const info = await this.ctx.mediainfo.ensure(fileId, s)
        if (!info) throw new Error('media file not found')
        if (info.error || !info.facts) throw new Error(info.error ?? 'media could not be read')
        if (info.fingerprint !== generation) throw new Error('media changed while scanning')
        const facts = info.facts
        const found: (Omit<typeof schema.inventory.$inferInsert, 'fileId' | 'generation'>)[] = facts.subtitles.map(stream=>({
          location: `stream:${stream.index}`, embedded: true, format: stream.codec, language: stream.language, forced: stream.forced, hi: stream.hi,
        }))
        const entries = await readdir(dirname(path))
        for (const name of entries) {
          const meta = sidecar(path, name)
          if (!meta) continue
          const target = resolve(dirname(path), name)
          await safePath(root, target)
          let error: string | null = null, hash: string | null = null
          try {
            hash = await fileHash(target)
            if (meta.format === 'idx') await safePath(root, target.slice(0,-4) + '.sub')
            else validateText(decode(await readFile(target)), meta.format as SubtitleFormat, facts.duration)
          } catch (e) { error = this.message(e) }
          found.push({ ...meta, location: relative(root,target), embedded: false, hash, valid: !error, error })
        }
        s.throwIfAborted()
        if (generation !== await fingerprint(path)) throw new Error('media changed while scanning')
        this.db.transaction(tx => {
          tx.update(schema.inventory).set({present: false}).where(eq(schema.inventory.fileId,fileId)).run()
          for (const row of found) {
            const prior = tx.select().from(schema.inventory).where(and(eq(schema.inventory.fileId,fileId),eq(schema.inventory.location,row.location))).get()
            const edited = prior?.managed && (prior.hash !== row.hash || prior.generation !== generation)
            const values = { ...row, fileId, generation, present: true, managed: edited ? false : prior?.managed ?? false, protected: edited || prior?.protected || false }
            tx.insert(schema.inventory).values(values).onConflictDoUpdate({target:[schema.inventory.fileId,schema.inventory.location],set:values}).run()
          }
          tx.insert(schema.probes).values({fileId,generation,error:null,scannedAt:this.now()}).onConflictDoUpdate({target:schema.probes.fileId,set:{generation,error:null,scannedAt:this.now()}}).run()
        })
        this.recompute(fileId)
        this.queueWanted(fileId)
        return this.files(file.mediaId).find(v=>v.file.id === fileId)!
      } catch (e) {
        s.throwIfAborted()
        if (!this.ctx.library.db.select().from(mediaFiles).where(eq(mediaFiles.id,fileId)).get()) return
        const error = this.message(e)
        this.db.insert(schema.probes).values({fileId,generation,error,scannedAt:this.now()}).onConflictDoUpdate({target:schema.probes.fileId,set:{generation,error,scannedAt:this.now()}}).run()
        this.recompute(fileId)
      } finally { this.changed() }
    })
  }
  private context(fileId: number): { query: SubtitleSearchContext; monitored: boolean } {
    const {file,item} = this.file(fileId)
    const facts = this.ctx.mediainfo.get(fileId)?.facts
    let episodes: SubtitleSearchContext['episodes'] = [], monitored = item.monitored
    if (item.kind === 'series') {
      const series = this.ctx.get('series')
      if (series) {
        const links = series.episodeFiles(item.id)
        const rows = series.episodes(item.id).filter(e=>links.get(e.id)?.id === fileId)
        episodes = rows.map(e=>({season:e.season,number:e.number}))
        monitored = monitored && rows.some(e=>e.monitored)
      } else monitored = false
    }
    return { query: {kind:item.kind as 'movie'|'series',title:item.title,year:item.year,ids:item.externalIds,releaseName:file.releaseName,releaseGroup:file.releaseGroup,size:file.size,duration:facts?.duration,episodes}, monitored }
  }
  recompute(fileId: number) {
    const {item} = this.file(fileId)
    const {profile} = this.effective(item)
    if (!profile) { this.db.delete(schema.wanted).where(eq(schema.wanted.fileId,fileId)).run(); return }
    const p = this.db.select().from(schema.probes).where(eq(schema.probes.fileId,fileId)).get()
    const rows = this.db.select().from(schema.inventory).where(eq(schema.inventory.fileId,fileId)).all().filter(r=>r.generation === p?.generation)
    const {monitored,query} = this.context(fileId)
    const requirementIds = new Set(profile.requirements.map(r=>r.id))
    for (const row of this.db.select().from(schema.wanted).where(eq(schema.wanted.fileId,fileId)).all()) if (!requirementIds.has(row.requirementId)) this.db.delete(schema.wanted).where(eq(schema.wanted.id,row.id)).run()
    for (const r of profile.requirements) {
      let result = evaluate(r,profile,rows,!!p && !p.error,monitored,this.now())
      if (result.state !== 'disabled' && item.kind === 'series' && !query.episodes.length) result = {state:'unknown',reason:'episode identity not yet available'}
      const prior = this.db.select().from(schema.wanted).where(and(eq(schema.wanted.fileId,fileId),eq(schema.wanted.requirementId,r.id))).get()
      const same = !!prior && prior.generation === p?.generation && prior.profileId === profile.id && prior.revision === profile.revision
      const values = {fileId,requirementId:r.id,profileId:profile.id,revision:profile.revision,generation:p?.generation ?? 'unknown',state:result.state,reason:result.reason,attempts:same ? prior.attempts : 0,nextSearchAt:same ? prior.nextSearchAt : 0}
      if (same && ['missing','upgradeable'].includes(result.state) && prior.nextSearchAt > this.now()) { values.state = prior.state === 'blocked' ? 'blocked' : 'waiting'; values.reason = prior.reason }
      this.db.insert(schema.wanted).values(values).onConflictDoUpdate({target:[schema.wanted.fileId,schema.wanted.requirementId],set:values}).run()
    }
  }
  sweep() {
    for (const view of this.files()) {
      this.recompute(view.file.id)
      this.queueWanted(view.file.id)
    }
    this.changed()
  }
  private queueWanted(fileId: number) {
    const rows = this.db.select().from(schema.wanted).where(eq(schema.wanted.fileId,fileId)).all()
    for (const row of rows) if (['missing','upgradeable','waiting','blocked'].includes(row.state) && row.nextSearchAt <= this.now()) this.ctx.jobs.enqueue('subtitles.search',{fileId:row.fileId,requirementId:row.requirementId},{dedupeKey:`subtitles:search:${row.fileId}:${row.requirementId}`})
  }
  register(provider: SubtitleProvider) {
    return this.ctx.effect(() => {
      if (this.providers.has(provider.id)) throw new Error('subtitle provider already registered')
      this.providers.set(provider.id,provider)
      this.changed()
      return () => { this.providers.delete(provider.id); this.changed() }
    }, `subtitles.register(${provider.id})`)
  }
  health() { return [...this.providers.values()].map(p=>({id:p.id,name:p.name,automatic:p.automatic,priority:p.priority,...this.db.select().from(schema.providerState).where(eq(schema.providerState.id,p.id)).get()})) }
  quota(id: string, remaining: number | null, resetAt: number | null) {
    this.db.insert(schema.providerState).values({id,remaining,resetAt}).onConflictDoUpdate({target:schema.providerState.id,set:{remaining,resetAt}}).run(); this.changed()
  }
  private async providerCall<T>(p: SubtitleProvider, fn: () => Promise<T>) {
    const state = this.db.select().from(schema.providerState).where(eq(schema.providerState.id,p.id)).get()
    if (state?.retryAt && state.retryAt > this.now()) throw new SubtitleProviderError(state.code as 'quota', state.error ?? 'provider paused', state.retryAt)
    if (state?.remaining === 0 && (!state.resetAt || state.resetAt > this.now())) throw new SubtitleProviderError('quota','provider download quota exhausted',state.resetAt ?? this.now()+3600_000)
    try {
      const result = await fn()
      this.db.insert(schema.providerState).values({id:p.id}).onConflictDoUpdate({target:schema.providerState.id,set:{error:null,code:null,retryAt:null}}).run()
      return result
    } catch (e) {
      const error = e instanceof SubtitleProviderError ? e : new SubtitleProviderError('temporary','provider operation failed')
      const retryAt = error.retryAt ?? this.now() + (error.code === 'auth' ? 86_400_000 : error.code === 'quota' ? 3600_000 : 300_000)
      this.db.insert(schema.providerState).values({id:p.id,error:error.message,code:error.code,retryAt}).onConflictDoUpdate({target:schema.providerState.id,set:{error:error.message,code:error.code,retryAt}}).run()
      throw error
    } finally { this.changed() }
  }
  async testProvider(id: string) {
    const p = this.providers.get(id)
    if (!p) return {ok:false,message:'provider is not running'}
    this.db.update(schema.providerState).set({retryAt:null,remaining:null}).where(eq(schema.providerState.id,id)).run()
    try { return {ok:true,message:await this.providerCall(p,()=>p.test(this.signal()))} }
    catch(e) { return {ok:false,message:this.message(e)} }
  }
  private requirement(fileId: number, id: string) {
    const {item} = this.file(fileId)
    const profile = this.effective(item).profile
    const requirement = profile?.requirements.find(r=>r.id === id)
    if (!profile || !requirement) throw new Error('assign a subtitle profile with this requirement first')
    return {profile,requirement}
  }
  async search(fileId: number, requirementId: string, automatic = false, signal?: AbortSignal) {
    const s = this.signal(signal)
    await this.scan(fileId,s)
    const {profile,requirement} = this.requirement(fileId,requirementId)
    const {path,root} = this.file(fileId)
    const inventory = this.db.select().from(schema.probes).where(eq(schema.probes.fileId,fileId)).get()
    if (!inventory || inventory.error) throw new Error('complete a successful scan before searching')
    await safePath(root,path)
    const generation = await fingerprint(path)
    const {query} = this.context(fileId)
    query.hash = await movieHash(path)
    if (query.kind === 'series' && !query.episodes.length) throw new Error('episode identity unavailable')
    const rows: SearchRow[] = [], errors: {provider: string; message: string}[] = []
    for (const [token,t] of this.tickets) if (t.expires <= this.now()) this.tickets.delete(token)
    await Promise.all([...this.providers.values()].filter(p=>!automatic || p.automatic).map(async p=>{
      try {
        const candidates = await this.providerCall(p,()=>p.search(query,requirement,s))
        const seen = new Set<string>()
        for (const candidate of candidates.slice(0,100)) {
          if (seen.has(candidate.id)) continue
          seen.add(candidate.id)
          const c = {...candidate,providerId:p.id}
          const result = scoreCandidate(c,query,requirement)
          if (this.db.select().from(schema.blocklist).where(and(eq(schema.blocklist.fileId,fileId),eq(schema.blocklist.generation,generation),eq(schema.blocklist.candidateId,`${p.id}:${c.id}`))).get()) result.reasons.push('candidate blocklisted')
          const token = randomUUID()
          this.tickets.set(token,{candidate:c,fileId,requirementId,profileId:profile.id,revision:profile.revision,generation,expires:this.now()+15*60_000,...result})
          rows.push({token,name:c.name,provider:p.name,language:c.language,forced:c.forced,hi:c.hi,format:c.format,...result})
        }
      } catch(e) { s.throwIfAborted(); errors.push({provider:p.name,message:this.message(e)}) }
    }))
    rows.sort((a,b)=>b.score-a.score || ((requirement.hi === 'prefer' ? Number(b.hi === true)-Number(a.hi === true) : 0)) || (this.providers.get(this.tickets.get(a.token)!.candidate.providerId)!.priority - this.providers.get(this.tickets.get(b.token)!.candidate.providerId)!.priority) || a.token.localeCompare(b.token))
    return {rows,errors}
  }
  private ticket(token: string) {
    const ticket = this.tickets.get(token)
    if (!ticket || ticket.expires <= this.now()) throw new Error('search result expired; search again')
    return ticket
  }
  private async automatic(fileId: number, requirementId: string, signal: AbortSignal) {
    try {
      await this.scan(fileId,signal)
      const wanted = this.db.select().from(schema.wanted).where(and(eq(schema.wanted.fileId,fileId),eq(schema.wanted.requirementId,requirementId))).get()
      if (!wanted || !['missing','upgradeable','waiting','blocked'].includes(wanted.state) || wanted.nextSearchAt > this.now()) return
      const {rows,errors} = await this.search(fileId,requirementId,true,signal)
      let tried = 0
      for (const row of rows.filter(r=>!r.reasons.length)) {
        try { await this.acquire(row.token,false,signal,true); return }
        catch (e) { signal.throwIfAborted(); if (++tried >= 3) throw e }
      }
      this.defer(fileId,requirementId,errors.length ? errors.map(e=>`${e.provider}: ${e.message}`).join('; ') : 'no qualifying results', errors.length > 0)
    } catch(e) { signal.throwIfAborted(); if (this.ctx.library.db.select().from(mediaFiles).where(eq(mediaFiles.id,fileId)).get()) this.defer(fileId,requirementId,this.message(e),true) }
  }
  private defer(fileId: number, requirementId: string, reason: string, blocked: boolean) {
    const row = this.db.select().from(schema.wanted).where(and(eq(schema.wanted.fileId,fileId),eq(schema.wanted.requirementId,requirementId))).get()
    if (!row || row.state === 'satisfied' || row.state === 'disabled') return
    const attempts = row.attempts+1
    const hours = blocked ? 1 : attempts === 1 ? 6 : attempts === 2 ? 24 : 72
    this.db.update(schema.wanted).set({state:blocked?'blocked':'waiting',reason,attempts,nextSearchAt:this.now()+hours*3600_000}).where(eq(schema.wanted.id,row.id)).run(); this.changed()
  }
  async acquire(token: string, override = false, signal?: AbortSignal, automatic = false) {
    return this.acquireTicket(this.ticket(token),override,signal,automatic)
  }
  private async acquireTicket(t: Ticket, override = false, signal?: AbortSignal, automatic = false) {
    return this.locked(t.fileId,async()=>{
      const s = this.signal(signal); s.throwIfAborted()
      if (t.expires <= this.now()) throw new Error('search result expired; search again')
      const {file,item,root,path} = this.file(t.fileId)
      const check = async()=>{
        s.throwIfAborted(); await safePath(root,path)
        const live = this.file(t.fileId)
        const {profile} = this.requirement(t.fileId,t.requirementId)
        if (live.path !== path || t.generation !== await fingerprint(path) || profile.id !== t.profileId || profile.revision !== t.revision) throw new Error('media or profile changed; search again')
        if (automatic && (!profile.policy.automatic || (profile.policy.monitoredOnly && !this.context(t.fileId).monitored))) throw new Error('automatic acquisition no longer enabled')
      }
      await check()
      if (t.reasons.length && !override) throw new Error('candidate rejected; explicitly confirm manual override')
      if (t.reasons.includes('candidate blocklisted')) throw new Error('unblock this candidate before downloading')
      const {profile,requirement} = this.requirement(t.fileId,t.requirementId)
      const p = this.providers.get(t.candidate.providerId)
      if (!p) throw new Error('provider is no longer enabled')
      const currentRows = this.db.select().from(schema.inventory).where(eq(schema.inventory.fileId,t.fileId)).all().filter(r=>r.generation === t.generation)
      const evaluation = evaluate(requirement,profile,currentRows,true,this.context(t.fileId).monitored,this.now())
      if (automatic && evaluation.state !== 'missing' && evaluation.state !== 'upgradeable') return
      if (automatic && evaluation.current && t.score < (evaluation.current.score ?? 100)+profile.policy.upgradeDelta) throw new Error('candidate is not a sufficient upgrade')
      const suffix = `${t.candidate.language ?? requirement.language}${t.candidate.forced ? '.forced' : ''}${t.candidate.hi ? '.hi' : ''}`
      const location = file.path.slice(0,-extname(file.path).length)+`.${suffix}.${t.candidate.format}`
      const target = resolve(root,location)
      await safePath(root,target,false)
      const existing = this.db.select().from(schema.inventory).where(and(eq(schema.inventory.fileId,t.fileId),eq(schema.inventory.location,location))).get()
      const oldHash = await this.optionalHash(target)
      if (oldHash && (!existing?.managed || existing.protected || existing.hash !== oldHash || existing.generation !== t.generation)) throw new Error('destination contains an unmanaged, protected, or modified subtitle')
      let text = decode(unpack(await this.providerCall(p,()=>p.download(t.candidate,s)),t.candidate.format))
      const duration = this.context(t.fileId).query.duration
      validateText(text,t.candidate.format,duration)
      let sync: schema.Inventory['sync'] = 'off', syncError: string | null = null
      if (profile.policy.sync !== 'off') {
        try {
          if (t.candidate.forced) throw new Error('forced subtitles require manual sync')
          text = await this.externalSync(text,t.candidate.format,path,s); sync = 'succeeded'
        } catch(e) { s.throwIfAborted(); if (profile.policy.sync === 'required') throw e; sync = 'failed'; syncError = this.message(e) }
      }
      validateText(text,t.candidate.format,duration)
      if (oldHash === hashBytes(text)) { this.defer(t.fileId,t.requirementId,'candidate has identical content',false); return }
      await check()
      if (oldHash !== await this.optionalHash(target)) throw new Error('subtitle changed during download')
      const record: schema.InstallRecord = {fileId:t.fileId,generation:t.generation,location,format:t.candidate.format,language:t.candidate.language ?? requirement.language,forced:t.candidate.forced,hi:t.candidate.hi,providerId:p.id,candidateId:t.candidate.id,score:t.score,evidence:t.evidence,acquiredAt:existing?.acquiredAt ?? evaluation.current?.acquiredAt ?? this.now(),sync,syncError}
      const operation = await this.install(root,target,text,oldHash,record)
      // If a different managed variant satisfied this requirement, retain it as a protected
      // backup rather than delete a file that might satisfy another requirement.
      this.recompute(t.fileId); this.changed()
      this.ctx.emit('subtitles/action',item.id,existing || evaluation.current ? 'subtitle-upgraded':'subtitle-downloaded',{fileId:file.id,provider:p.name,score:t.score,location,operationId:operation.id})
      return operation.id
    })
  }
  private async optionalHash(path: string) {
    try { return await fileHash(path) } catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
  private async install(root: string, target: string, text: string, oldHash: string | null, record: schema.InstallRecord) {
    const id = randomUUID()
    const staged = resolve(dirname(target),`.magpie-${id}.${record.format}`), backup = resolve(dirname(target),`.magpie-${id}.backup`)
    await safePath(root,target,false); await safePath(root,staged,false); await safePath(root,backup,false)
    await writeFile(staged,text,{flag:'wx'})
    const operation = this.db.insert(schema.operations).values({id,fileId:record.fileId,root,target,staged,backup,oldHash,newHash:hashBytes(text),record,state:'prepared',createdAt:this.now()}).returning().get()
    try {
      if (oldHash !== await this.optionalHash(target)) throw new Error('subtitle changed before installation')
      if (oldHash) await rename(target,backup)
      // Hard-link creation is an atomic no-clobber install, including on Windows.
      const { link } = await import('node:fs/promises')
      await link(staged,target)
      await rm(staged)
      this.finalize(operation)
      return operation
    } catch(e) { await this.recoverOperation(operation); throw e }
  }
  private finalize(op: typeof schema.operations.$inferSelect) {
    if (!this.ctx.library.db.select().from(mediaFiles).where(eq(mediaFiles.id,op.fileId)).get()) { this.db.update(schema.operations).set({state:'blocked',error:'media record removed during installation'}).where(eq(schema.operations.id,op.id)).run(); return }
    const {record} = op
    this.db.transaction(tx=>{
      const values = {...record,hash:op.newHash,managed:true,protected:false,embedded:false,present:true,valid:true,error:null}
      tx.insert(schema.inventory).values(values).onConflictDoUpdate({target:[schema.inventory.fileId,schema.inventory.location],set:values}).run()
      tx.update(schema.operations).set({state:'done',error:null}).where(eq(schema.operations.id,op.id)).run()
    })
  }
  async recover() {
    for (const op of this.db.select().from(schema.operations).where(ne(schema.operations.state,'done')).all()) if (op.state !== 'rolled-back') await this.recoverOperation(op)
  }
  private async recoverOperation(op: typeof schema.operations.$inferSelect) {
    try {
      for (const path of [op.target,op.staged,op.backup]) await safePath(op.root,path,false)
      const target = await this.optionalHash(op.target)
      if (target === op.newHash) { this.finalize(op); await rm(op.staged,{force:true}); return }
      if (target !== null && target !== op.oldHash) throw new Error('recovery found a user-modified destination')
      if (!target && op.oldHash) {
        if (await this.optionalHash(op.backup) !== op.oldHash) throw new Error('recovery backup unavailable')
        const {link} = await import('node:fs/promises'); await link(op.backup,op.target)
      }
      await rm(op.staged,{force:true})
      this.db.update(schema.operations).set({state:'rolled-back',error:null}).where(eq(schema.operations.id,op.id)).run()
    } catch(e) { this.db.update(schema.operations).set({state:'blocked',error:this.message(e)}).where(eq(schema.operations.id,op.id)).run() }
  }
  async sync(inventoryId: number, offset?: number, signal?: AbortSignal) {
    const row = this.db.select().from(schema.inventory).where(eq(schema.inventory.id,inventoryId)).get()
    if (!row) throw new Error('subtitle not found')
    return this.locked(row.fileId,async()=>{
      const s = this.signal(signal)
      if (row.embedded || !row.managed || row.protected || !row.present || !['srt','ass','ssa','vtt'].includes(row.format)) throw new Error('sync requires an unprotected managed text subtitle')
      const {root,path,item} = this.file(row.fileId)
      const target = resolve(root,row.location)
      await safePath(root,target)
      if (row.generation !== await fingerprint(path) || row.hash !== await fileHash(target)) throw new Error('media or subtitle changed; rescan first')
      const original = decode(await readFile(target)), format = row.format as SubtitleFormat
      let text: string
      try {
        text = offset === undefined ? await this.externalSync(original,format,path,s) : shifted(original,format,offset)
        validateText(text,format,this.context(row.fileId).query.duration)
        s.throwIfAborted()
        if (row.generation !== await fingerprint(path) || row.hash !== await fileHash(target)) throw new Error('media or subtitle changed during sync')
      } catch(e) {
        this.db.update(schema.inventory).set({sync:'failed',syncError:this.message(e)}).where(eq(schema.inventory.id,row.id)).run(); this.changed(); throw e
      }
      const op = await this.install(root,target,text,row.hash,{...row,evidence:row.evidence ?? [],acquiredAt:row.acquiredAt ?? this.now(),sync:'succeeded',syncError:null})
      this.ctx.emit('subtitles/action',item.id,'subtitle-synced',{location:row.location,fileId:row.fileId,operationId:op.id,offset})
      this.changed(); return op.id
    })
  }
  private async externalSync(text: string, format: SubtitleFormat, video: string, signal: AbortSignal) {
    if (!this.config.syncBinary) throw new Error('configure a sync executable first')
    if (format !== 'srt') throw new Error('external sync currently supports SRT; use offset adjustment for other formats')
    const root = dirname(video), id = randomUUID()
    const input = resolve(root,`.magpie-sync-${id}.srt`), output = resolve(root,`.magpie-sync-${id}-out.srt`)
    await safePath(root,input,false); await safePath(root,output,false)
    try {
      await writeFile(input,text,{flag:'wx'})
      const args = this.config.syncEngine === 'alass' ? [video,input,output] : [video,'-i',input,'-o',output]
      await run(this.config.syncBinary,args,signal,5*60_000)
      if ((await stat(output)).size > MAX_SUBTITLE) throw new Error('sync output too large')
      const synced = decode(await readFile(output))
      const before = validateText(text,format), after = validateText(synced,format)
      if (before.length !== after.length || before.some((c,i)=>c.text !== after[i]!.text || Math.abs(c.start-after[i]!.start)>600)) throw new Error('sync output changed text or exceeded timing bounds')
      return synced
    } finally { await rm(input,{force:true}); await rm(output,{force:true}) }
  }
  async undo(id: string) {
    const op = this.db.select().from(schema.operations).where(eq(schema.operations.id,id)).get()
    if (!op || op.state !== 'done' || !op.oldHash) throw new Error('no replacement backup is available')
    return this.locked(op.fileId,async()=>{
      await safePath(op.root,op.target); await safePath(op.root,op.backup)
      if (await fileHash(op.target) !== op.newHash || await fileHash(op.backup) !== op.oldHash) throw new Error('subtitle or backup changed; undo refused')
      const record = {...op.record,score:null,evidence:['restored backup'],sync:'off' as const,syncError:null}
      const restored = await this.install(op.root,op.target,decode(await readFile(op.backup)),op.newHash,record)
      this.db.update(schema.inventory).set({protected:true}).where(and(eq(schema.inventory.fileId,op.fileId),eq(schema.inventory.location,op.record.location))).run()
      this.recompute(op.fileId); this.changed(); return restored.id
    })
  }
  protect(id: number, value: boolean) { this.db.update(schema.inventory).set({protected:value}).where(eq(schema.inventory.id,id)).run(); const row = this.db.select().from(schema.inventory).where(eq(schema.inventory.id,id)).get(); if(row)this.recompute(row.fileId); this.changed() }
  async adopt(id: number) {
    const row = this.db.select().from(schema.inventory).where(eq(schema.inventory.id,id)).get()
    if (!row || row.embedded || !row.present || !row.valid) throw new Error('only valid external subtitles can be adopted')
    const {root,path} = this.file(row.fileId)
    const target = resolve(root,row.location); await safePath(root,target)
    if (row.generation !== await fingerprint(path) || row.hash !== await fileHash(target)) throw new Error('rescan changed files before adopting')
    this.db.update(schema.inventory).set({managed:true,protected:false,acquiredAt:this.now(),score:null}).where(eq(schema.inventory.id,id)).run(); this.changed()
  }
  block(token: string) {
    const t = this.ticket(token)
    this.db.insert(schema.blocklist).values({fileId:t.fileId,generation:t.generation,candidateId:`${t.candidate.providerId}:${t.candidate.id}`}).onConflictDoNothing().run()
    this.tickets.delete(token); this.changed()
  }
  unblock(id: number) { this.db.delete(schema.blocklist).where(eq(schema.blocklist.id,id)).run(); this.changed() }
  blocked() { return this.db.select().from(schema.blocklist).all() }
  operationList() { return this.db.select().from(schema.operations).all().map(({root:_root,target:_target,staged:_staged,backup:_backup,...op})=>op) }
  async toolHealth() {
    const test = async (binary: string, args: string[]) => { try { await run(binary,args,this.signal(),5000); return 'available' } catch(e) { return this.message(e) } }
    const { ffprobe } = await this.ctx.mediaTools.check()
    return {ffprobe:ffprobe.ok ? 'available' : ffprobe.detail,sync:this.config.syncBinary ? await test(this.config.syncBinary,['--help']):'not configured'}
  }
  private message(e: unknown) { return e instanceof Error ? e.message : String(e) }
}
export default SubtitlesService
