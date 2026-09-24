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
  ctx.api.post('/movies/:id/search', async ({ params }) => {
    find(params.id!)
    if (!movies.searchAndGrab) throw new ApiError(409, 'no indexer or download client is set up')
    const grab = await movies.searchAndGrab(Number(params.id))
    return { grabbed: grab ? grab.title : null }
  })
}
