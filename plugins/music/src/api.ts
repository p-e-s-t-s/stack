// REST endpoints under /api/v1/music: artists, their albums and tracks, lookup and searching.

import { ApiError } from '@magpiejs/api'
import type { Context } from 'cordis'
import type { MusicService } from './index'

export default function api(ctx: Context, music: MusicService) {
  const find = (id: string) => {
    const artist = music.get(Number(id))
    if (!artist) throw new ApiError(404, `no artist ${id}`)
    return artist
  }

  ctx.api.get('/music', () => music.list())
  ctx.api.get('/music/lookup', ({ query }) => {
    const term = query.get('term')
    if (!term) throw new ApiError(400, 'term is required')
    return music.lookup(term)
  })
  ctx.api.get('/music/:id', ({ params }) => ({
    ...find(params.id!),
    albums: music.albums(Number(params.id)),
  }))
  ctx.api.get('/music/:id/albums/:albumId', async ({ params }) => {
    find(params.id!)
    const album = music.album(Number(params.albumId))
    if (!album || album.mediaId !== Number(params.id))
      throw new ApiError(404, `no album ${params.albumId}`)
    return { ...album, tracks: await music.ensureTracks(album.id) }
  })
  ctx.api.post('/music', async ({ body }) => {
    if (!body?.artistId || !body.profileId || !body.rootFolderId)
      throw new ApiError(400, 'artistId, profileId and rootFolderId are required')
    return music.add(body)
  })
  ctx.api.post('/music/:id/refresh', async ({ params }) => {
    find(params.id!)
    await music.refresh(Number(params.id))
    return music.get(Number(params.id))
  })
  ctx.api.post('/music/:id/search', async ({ params, body }) => {
    find(params.id!)
    return { grabbed: await music.searchAndGrab(Number(params.id), body?.albumIds) }
  })
  ctx.api.delete('/music/:id', ({ params, query }) => {
    find(params.id!)
    music.remove(Number(params.id), query.get('deleteFiles') === 'true')
  })
}
