import type { Context } from 'cordis'
import z from 'schemastery'
import type {} from '@magpiejs/subtitles'
import { language } from '@magpiejs/subtitles'
import { json, request } from '@magpiejs/subtitles/transport'
import { SubtitleProviderError, type SubtitleCandidate, type SubtitleProvider, type SubtitleSearchContext } from '@magpiejs/types'

export const name = 'subtitles-subdl'
export const inject = ['subtitles']
export interface Config { name:string; apiKey:string; priority:number; automatic:boolean }
export const Config: z<Config> = z.object({name:z.string().default('SubDL'),apiKey:z.string().role('secret').required(),priority:z.natural().default(20),automatic:z.boolean().default(true)})
export function candidates(data:any, providerId:string, q:SubtitleSearchContext): SubtitleCandidate[] {
  if (!data?.status || !Array.isArray(data.subtitles)) throw new SubtitleProviderError('invalid','invalid SubDL search response')
  const feature = data.results?.[0]
  const ids:Record<string,string> = {}
  if (feature?.imdb_id)ids.imdb = String(feature.imdb_id)
  if (feature?.tmdb_id)ids.tmdb = String(feature.tmdb_id)
  return data.subtitles.flatMap((sub:any)=>{
    const members = Array.isArray(sub.unpack_files) && sub.unpack_files.length ? sub.unpack_files : sub.full_season ? [] : [sub]
    return members.filter((f:any)=>typeof f.url === 'string').map((f:any)=>{
      const format = ['srt','ass','ssa','vtt'].includes(f.format) ? f.format : 'srt'
      return {id:f.url,providerId,fileId:f.url,name:f.name ?? f.release_name ?? 'Subtitle',language:language(f.language),forced:typeof f.forced === 'boolean'?f.forced:null,hi:typeof f.hi === 'boolean'?f.hi:null,format,ids,year:feature?.year,
        episodes:q.kind === 'series' && Number.isInteger(f.season) && Number.isInteger(f.episode) ? [{season:f.season,number:f.episode}]:undefined,
        releaseName:f.release_name ?? sub.release_name,
      }
    })
  })
}
export function apply(ctx:Context, config:Config) {
  const id = `subdl:${ctx.fiber.entry?.options.id ?? config.name}`
  const provider:SubtitleProvider = {
    id,name:config.name,priority:config.priority,automatic:config.automatic,
    async search(q,r,signal) {
      const params = new URLSearchParams({api_key:config.apiKey,type:q.kind === 'movie'?'movie':'tv',languages:(r.language === 'pt-BR'?'BR_PT':r.language).toUpperCase(),unpack:'1',releases:'1',hi:'1',subs_per_page:'30',client:'custom_integration'})
      if(q.ids.imdb)params.set('imdb_id',q.ids.imdb)
      else if(q.ids.tmdb)params.set('tmdb_id',q.ids.tmdb)
      else params.set('film_name',q.title)
      if(q.episodes.length === 1){params.set('season_number',String(q.episodes[0]!.season));params.set('episode_number',String(q.episodes[0]!.number))}
      return candidates(await json(`https://api.subdl.com/api/v1/subtitles?${params}`,{},signal),id,q)
    },
    async download(c,signal) {
      const url = new URL(c.fileId,'https://dl.subdl.com')
      if(url.protocol !== 'https:' || url.hostname !== 'dl.subdl.com' || !url.pathname.startsWith('/subtitle/'))throw new SubtitleProviderError('invalid','invalid SubDL download URL')
      return (await request(url.href,{},signal)).bytes
    },
    async test(signal) { const data = await json(`https://api.subdl.com/api/v1/me?api_key=${encodeURIComponent(config.apiKey)}`,{},signal); if(data.status === false)throw new SubtitleProviderError('auth','SubDL key rejected'); return 'SubDL connection working' },
  }
  ctx.subtitles.register(provider)
}
