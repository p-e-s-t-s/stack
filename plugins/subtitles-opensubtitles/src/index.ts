import type { Context } from 'cordis'
import z from 'schemastery'
import type {} from '@magpiejs/subtitles'
import { language } from '@magpiejs/subtitles'
import { json, request } from '@magpiejs/subtitles/transport'
import { SubtitleProviderError, type SubtitleCandidate, type SubtitleProvider, type SubtitleSearchContext } from '@magpiejs/types'

export const name = 'subtitles-opensubtitles'
export const inject = ['subtitles']
export interface Config { name:string; apiKey:string; username:string; password:string; userAgent:string; priority:number; automatic:boolean }
export const Config: z<Config> = z.object({
  name:z.string().default('OpenSubtitles'), apiKey:z.string().role('secret').required(), username:z.string().default(''), password:z.string().role('secret').default(''),
  userAgent:z.string().default('Magpie v0.0.0').description('User-Agent registered with your OpenSubtitles application key.'), priority:z.natural().default(10), automatic:z.boolean().default(true),
})
const BASE = 'https://api.opensubtitles.com/api/v1'
export function candidates(data:any, providerId:string, q:SubtitleSearchContext): SubtitleCandidate[] {
  if (!Array.isArray(data?.data)) throw new SubtitleProviderError('invalid','invalid OpenSubtitles search response')
  return data.data.flatMap((row:any)=>{
    const a = row.attributes, f = a?.feature_details
    if (!a || !Array.isArray(a.files)) return []
    const ids: Record<string,string> = {}
    const imdb = q.kind === 'series' ? f?.parent_imdb_id : f?.imdb_id
    const tmdb = q.kind === 'series' ? f?.parent_tmdb_id : f?.tmdb_id
    if (imdb) ids.imdb = `tt${String(imdb).replace(/^tt/,'')}`
    if (tmdb) ids.tmdb = String(tmdb)
    return a.files.filter((file:any)=>Number.isSafeInteger(file.file_id)).map((file:any)=>({
      id:`${row.id}:${file.file_id}`,providerId,fileId:String(file.file_id),name:file.file_name ?? a.release ?? String(row.id),language:language(a.language),
      forced:typeof a.foreign_parts_only === 'boolean' ? a.foreign_parts_only:null,hi:typeof a.hearing_impaired === 'boolean' ? a.hearing_impaired:null,format:'srt' as const,ids,
      year:f?.year,episodes:q.kind === 'series' && Number.isInteger(f?.season_number) && Number.isInteger(f?.episode_number) ? [{season:f.season_number,number:f.episode_number}]:undefined,
      releaseName:a.release,hashMatch:a.moviehash_match === true,
    }))
  })
}
export function apply(ctx:Context, config:Config) {
  const id = `opensubtitles:${ctx.fiber.entry?.options.id ?? config.name}`
  let token:string|undefined, expires = 0
  const headers = () => ({'Api-Key':config.apiKey,'User-Agent':config.userAgent,'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})})
  const login = async(signal:AbortSignal)=>{
    if (!config.username || !config.password || (token && expires > Date.now())) return
    const data = await json(`${BASE}/login`,{method:'POST',headers:headers(),body:JSON.stringify({username:config.username,password:config.password})},signal)
    if (typeof data.token !== 'string') throw new SubtitleProviderError('auth','OpenSubtitles login failed')
    token = data.token; expires = Date.now()+23*3600_000
  }
  const provider:SubtitleProvider = {
    id,name:config.name,priority:config.priority,automatic:config.automatic,
    async search(q,r,signal) {
      const params = new URLSearchParams({languages:r.language,type:q.kind === 'movie'?'movie':'episode'})
      if(q.hash) params.set('moviehash',q.hash)
      if(q.ids.imdb)params.set(q.kind === 'series'?'parent_imdb_id':'imdb_id',q.ids.imdb.replace(/^tt/,''))
      else if(q.ids.tmdb)params.set(q.kind === 'series'?'parent_tmdb_id':'tmdb_id',q.ids.tmdb)
      else params.set('query',q.title)
      if(q.episodes.length === 1) {params.set('season_number',String(q.episodes[0]!.season)); params.set('episode_number',String(q.episodes[0]!.number))}
      if(r.forced !== 'either')params.set('foreign_parts_only',r.forced === 'forced'?'only':'exclude')
      if(r.hi === 'require' || r.hi === 'exclude')params.set('hearing_impaired',r.hi === 'require'?'only':'exclude')
      return candidates(await json(`${BASE}/subtitles?${params}`,{headers:headers()},signal),id,q)
    },
    async download(c,signal) {
      await login(signal)
      const data = await json(`${BASE}/download`,{method:'POST',headers:headers(),body:JSON.stringify({file_id:Number(c.fileId),sub_format:'srt'})},signal)
      const remaining = typeof data.remaining === 'number' ? data.remaining:null
      const reset = data.reset_time_utc ? Date.parse(data.reset_time_utc):NaN
      ctx.subtitles.quota(id,remaining,Number.isFinite(reset)?reset:null)
      if (typeof data.link !== 'string')throw new SubtitleProviderError('quota','OpenSubtitles did not return a download link',Number.isFinite(reset)?reset:undefined)
      const url = new URL(data.link)
      if(url.protocol !== 'https:' || !(url.hostname === 'opensubtitles.com' || url.hostname.endsWith('.opensubtitles.com'))) throw new SubtitleProviderError('invalid','invalid OpenSubtitles download host')
      return (await request(url.href,{},signal)).bytes
    },
    async test(signal) { await login(signal); await json(`${BASE}/infos/formats`,{headers:headers()},signal); return 'OpenSubtitles connection working' },
  }
  ctx.subtitles.register(provider)
}
