import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { SubtitlesService } from './index'

export default function console_(ctx: Context, s: SubtitlesService) {
  const snapshot = () => ({files:s.files(),media:s.media(),profiles:s.profiles(),defaults:s.kindDefaults(),providers:s.health(),operations:s.operationList(),blocklist:s.blocked(),tools:{syncBinary:s.config.syncBinary,syncEngine:s.config.syncEngine}})
  const data = {
    ...snapshot(),
    saveProfile:(input:unknown,id?:number)=>s.saveProfile(input,id),
    removeProfile:(id:number)=>s.removeProfile(id),
    setDefault:(kind:'movie'|'series',id:number|null)=>s.setDefault(kind,id),
    assign:(id:number,profileId:number|null|'inherit')=>s.assign(id,profileId),
    scan:(fileId:number)=>s.queueScan(fileId),
    search:(fileId:number,requirementId:string)=>s.search(fileId,requirementId),
    acquire:(token:string,override:boolean)=>s.queueAcquire(token,override),
    sync:(id:number,offset?:number)=>s.queueSync(id,offset),
    protect:(id:number,value:boolean)=>s.protect(id,value),
    adopt:(id:number)=>s.adopt(id),
    undo:(id:string)=>s.undo(id),
    block:(token:string)=>s.block(token),
    unblock:(id:number)=>s.unblock(id),
    testProvider:(id:string)=>s.testProvider(id),
    toolHealth:()=>s.toolHealth(),
    saveTools:(input:unknown)=>s.saveTools(input),
  }
  const entry = ctx.webui.addEntry({baseUrl:import.meta.url,source:'../client/index.ts',manifest:'../dist/manifest.json',access:{view:'library.read',call:'library.write',methods:{saveProfile:'settings.manage',removeProfile:'settings.manage',saveTools:'settings.manage',setDefault:'settings.manage'},data:{providers:'settings.manage',tools:'settings.manage'}},routes:['/subtitles','/settings/subtitles','/movies','/series']},data)
  ctx.on('subtitles/changed',()=>entry.mutate(d=>Object.assign(d,snapshot())))
}
export interface SubtitlesData {
  media: ReturnType<SubtitlesService['media']>
  files: ReturnType<SubtitlesService['files']>
  profiles: ReturnType<SubtitlesService['profiles']>
  defaults: ReturnType<SubtitlesService['kindDefaults']>
  providers: ReturnType<SubtitlesService['health']>
  operations: ReturnType<SubtitlesService['operationList']>
  blocklist: ReturnType<SubtitlesService['blocked']>
  saveProfile(input:unknown,id?:number):Promise<ReturnType<SubtitlesService['saveProfile']>>
  removeProfile(id:number):Promise<void>
  setDefault(kind:'movie'|'series',id:number|null):Promise<void>
  assign(id:number,profileId:number|null|'inherit'):Promise<void>
  scan(id:number):Promise<number>
  search:SubtitlesService['search']
  acquire(token:string,override:boolean):Promise<number>
  sync(id:number,offset?:number):Promise<number>
  protect(id:number,value:boolean):Promise<void>
  adopt:SubtitlesService['adopt']
  undo:SubtitlesService['undo']
  block(token:string):Promise<void>
  unblock(id:number):Promise<void>
  testProvider:SubtitlesService['testProvider']
  toolHealth:SubtitlesService['toolHealth']
  tools: Pick<SubtitlesService['config'],'syncBinary'|'syncEngine'>
  saveTools(input:unknown):Promise<void>
}
