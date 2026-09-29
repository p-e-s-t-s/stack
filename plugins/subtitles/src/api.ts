import { ApiError } from '@magpiejs/api'
import type { Context } from 'cordis'
import type { SubtitlesService } from './index'

export default function api(ctx: Context, s: SubtitlesService) {
  const id = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400,'invalid ID'); return n }
  const call = async (fn: () => unknown) => { try { return await fn() } catch(e) { if(e instanceof ApiError)throw e; throw new ApiError(400,e instanceof Error ? e.message : 'subtitle operation failed') } }
  ctx.api.get('/subtitles', r=>s.files(r.query.has('mediaId') ? id(r.query.get('mediaId')) : undefined))
  ctx.api.get('/subtitles/profiles',()=>s.profiles())
  ctx.api.post('/subtitles/profiles',r=>call(()=>s.saveProfile(r.body)))
  ctx.api.put('/subtitles/profiles/:id',r=>call(()=>s.saveProfile(r.body,id(r.params.id))))
  ctx.api.delete('/subtitles/profiles/:id',r=>call(()=>s.removeProfile(id(r.params.id))))
  ctx.api.get('/subtitles/defaults',()=>s.kindDefaults())
  ctx.api.put('/subtitles/defaults/:kind',r=>call(()=>s.setDefault(r.params.kind as 'movie'|'series',r.body?.profileId === null ? null : id(r.body?.profileId))))
  ctx.api.put('/subtitles/assignments/:id',r=>call(()=>s.assign(id(r.params.id),r.body?.profileId === 'inherit' ? 'inherit' : r.body?.profileId === null ? null : id(r.body?.profileId))))
  ctx.api.get('/subtitles/providers',()=>s.health())
  ctx.api.post('/subtitles/providers/:id/test',r=>s.testProvider(r.params.id!))
  ctx.api.get('/subtitles/tools',()=>s.toolHealth())
  ctx.api.put('/subtitles/tools',r=>call(()=>s.saveTools(r.body)))
  ctx.api.post('/subtitles/files/:id/scan',r=>call(()=>({jobId:s.queueScan(id(r.params.id))})))
  ctx.api.post('/subtitles/files/:id/search',r=>call(()=>s.search(id(r.params.id),String(r.body?.requirementId ?? ''))))
  ctx.api.post('/subtitles/acquire',r=>call(()=>({jobId:s.queueAcquire(String(r.body?.token ?? ''),r.body?.override === true)})))
  ctx.api.post('/subtitles/inventory/:id/sync',r=>call(()=>({jobId:s.queueSync(id(r.params.id),r.body?.offset)})))
  ctx.api.put('/subtitles/inventory/:id/protect',r=>call(()=>s.protect(id(r.params.id),r.body?.protected === true)))
  ctx.api.post('/subtitles/inventory/:id/adopt',r=>call(()=>s.adopt(id(r.params.id))))
  ctx.api.get('/subtitles/operations',()=>s.operationList())
  ctx.api.post('/subtitles/operations/:id/undo',r=>call(()=>s.undo(r.params.id!)))
  ctx.api.get('/subtitles/blocklist',()=>s.blocked())
  ctx.api.post('/subtitles/blocklist',r=>call(()=>s.block(String(r.body?.token ?? ''))))
  ctx.api.delete('/subtitles/blocklist/:id',r=>s.unblock(id(r.params.id)))
}
