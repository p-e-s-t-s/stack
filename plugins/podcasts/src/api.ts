// REST endpoints under /api/v1/podcasts, including OPML import and export.

import { ApiError } from '@magpiejs/api'
import type { Context } from 'cordis'
import type { PodcastsService } from './index'
import { toOpml } from './opml'

export default function api(ctx: Context, podcasts: PodcastsService) {
  const find = (id: string) => {
    const podcast = podcasts.get(Number(id))
    if (!podcast) throw new ApiError(404, `no podcast ${id}`)
    return podcast
  }

  ctx.api.get('/podcasts', () => podcasts.list())
  ctx.api.get('/podcasts/lookup', ({ query }) => {
    const term = query.get('term')
    if (!term) throw new ApiError(400, 'term is required')
    return podcasts.lookup(term)
  })
  ctx.api.get(
    '/podcasts/opml',
    () =>
      new Response(
        toOpml(podcasts.list().map((p) => ({ title: p.title, feedUrl: p.details.feedUrl }))),
        {
          headers: {
            'content-type': 'text/x-opml; charset=utf-8',
            'content-disposition': 'attachment; filename="magpie-podcasts.opml"',
          },
        },
      ),
  )
  ctx.api.post('/podcasts/opml', async ({ body }) => {
    if (typeof body?.opml !== 'string') throw new ApiError(400, 'send { "opml": "<opml…>" }')
    if (!body.rootFolderId) throw new ApiError(400, 'rootFolderId is required')
    return podcasts.importOpml(body.opml, {
      rootFolderId: body.rootFolderId,
      monitor: body.monitor,
    })
  })
  ctx.api.get('/podcasts/:id', ({ params }) => ({
    ...find(params.id!),
    episodes: podcasts.episodes(Number(params.id)),
  }))
  ctx.api.post('/podcasts', async ({ body }) => {
    if (!body?.feedUrl || !body.rootFolderId)
      throw new ApiError(400, 'feedUrl and rootFolderId are required')
    return podcasts.add(body)
  })
  ctx.api.post('/podcasts/:id/refresh', async ({ params }) => {
    find(params.id!)
    await podcasts.refresh(Number(params.id))
    return podcasts.get(Number(params.id))
  })
  ctx.api.delete('/podcasts/:id', ({ params, query }) => {
    find(params.id!)
    podcasts.remove(Number(params.id), query.get('deleteFiles') === 'true')
  })
}
