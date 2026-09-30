// REST endpoints under /api/v1/movies.

import { ApiError } from '@magpiejs/api'
import type { Context } from 'cordis'
import type { MoviesService } from './index'

export default function api(ctx: Context, movies: MoviesService) {
  const find = (id: string) => {
    const movie = movies.get(Number(id))
    if (!movie) throw new ApiError(404, `no movie ${id}`)
    return movie
  }

  ctx.api.get('/movies', () => movies.list())
  ctx.api.get('/movies/lookup', ({ query }) => {
    const term = query.get('term')
    if (!term) throw new ApiError(400, 'term is required')
    return movies.lookup(term)
  })
  ctx.api.get('/movies/:id', ({ params }) => find(params.id!))
  ctx.api.post('/movies', async ({ body }) => {
    if (!body?.tmdbId || !body.profileId || !body.rootFolderId)
      throw new ApiError(400, 'tmdbId, profileId and rootFolderId are required')
    return movies.add(body)
  })
  ctx.api.patch('/movies/:id', ({ params, body }) => {
    find(params.id!)
    const { profileId, monitored, minimumAvailability } = body ?? {}
    movies.update(Number(params.id), { profileId, monitored, minimumAvailability })
    return find(params.id!)
  })
  ctx.api.delete('/movies/:id', ({ params, query }) => {
    find(params.id!)
    movies.remove(Number(params.id), query.get('deleteFiles') === 'true')
  })
  ctx.api.post('/movies/:id/search', async ({ params, body }) => {
    find(params.id!)
    if (!movies.searchAndGrab) throw new ApiError(409, 'no indexer or download client is set up')
    const targetId = body?.targetId === undefined ? undefined : (body.targetId as number | null)
    const grab = await movies.searchAndGrab(Number(params.id), true, targetId)
    return { grabbed: grab ? grab.title : null }
  })

  // extra versions (4K next to 1080p): each has its own profile and file
  const versionId = (movieId: string, targetId: string) => {
    find(movieId)
    return Number(targetId)
  }
  ctx.api.post('/movies/:id/targets', ({ params, body }) => {
    find(params.id!)
    if (!body?.name || !body.profileId) throw new ApiError(400, 'name and profileId are required')
    return movies.addTarget(Number(params.id), {
      name: body.name,
      profileId: body.profileId,
      monitored: body.monitored,
    })
  })
  ctx.api.patch('/movies/:id/targets/:targetId', ({ params, body }) => {
    const { name, profileId, monitored } = body ?? {}
    return movies.updateTarget(Number(params.id), versionId(params.id!, params.targetId!), {
      name,
      profileId,
      monitored,
    })
  })
  ctx.api.delete('/movies/:id/targets/:targetId', async ({ params, query }) => {
    const files = query.get('files')
    if (files && files !== 'keep' && files !== 'delete')
      throw new ApiError(400, 'files must be keep or delete')
    await movies.removeTarget(
      Number(params.id),
      versionId(params.id!, params.targetId!),
      (files as 'keep' | 'delete' | null) ?? undefined,
    )
  })
}
