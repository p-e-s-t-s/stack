import type { Context } from '@cordisjs/client'
import AuthorList from './author-list.vue'
import AddAuthor from './add-author.vue'
import AuthorDetail from './author-detail.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/books', name: 'Books', order: 870, component: AuthorList })
  // registered before the detail page so `/books/add` isn't read as an id
  ctx.client.router.page({
    path: '/books/add',
    name: 'Add author',
    order: 0,
    component: AddAuthor,
    disabled: () => true,
  })
  ctx.client.router.page({
    path: '/books/:id',
    name: 'Author detail',
    order: 0,
    component: AuthorDetail,
    disabled: () => true,
  })
}
