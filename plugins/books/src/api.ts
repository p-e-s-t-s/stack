// REST endpoints under /api/v1/books: followed authors (one per format), their books, lookup,
// and searching.

import { ApiError } from '@magpiejs/api'
import type { Context } from 'cordis'
import { type BooksService, isBookKind } from './index'

export default function api(ctx: Context, books: BooksService) {
  const find = (id: string) => {
    const follow = books.get(Number(id))
    if (!follow) throw new ApiError(404, `no followed author ${id}`)
    return follow
  }

  ctx.api.get('/books', ({ query }) => {
    const kind = query.get('kind') ?? undefined
    if (kind === undefined) return books.list()
    if (!isBookKind(kind)) throw new ApiError(400, 'kind is ebook or audiobook')
    return books.list(kind)
  })
  ctx.api.get('/books/lookup', ({ query }) => {
    const term = query.get('term')
    if (!term) throw new ApiError(400, 'term is required')
    return books.lookup(term)
  })
  ctx.api.get('/books/:id', ({ params }) => ({
    ...find(params.id!),
    books: books.books(Number(params.id)),
  }))
  ctx.api.post('/books', async ({ body }) => {
    if (!body?.authorId || !isBookKind(body.kind) || !body.profileId || !body.rootFolderId)
      throw new ApiError(
        400,
        'authorId, kind (ebook or audiobook), profileId and rootFolderId are required',
      )
    return books.follow(body)
  })
  ctx.api.post('/books/:id/refresh', async ({ params }) => {
    find(params.id!)
    await books.refresh(Number(params.id))
    return books.get(Number(params.id))
  })
  ctx.api.post('/books/:id/search', async ({ params, body }) => {
    find(params.id!)
    return { grabbed: await books.searchAndGrab(Number(params.id), body?.bookIds) }
  })
  ctx.api.delete('/books/:id', ({ params, query }) => {
    find(params.id!)
    books.remove(Number(params.id), query.get('deleteFiles') === 'true')
  })
}
