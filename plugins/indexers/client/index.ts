import type { Context } from '@cordisjs/client'
import Indexers from './indexers.vue'

export default function (ctx: Context) {
  ctx.client.router.page({
    path: '/settings/indexers',
    name: 'Indexers',
    order: -110,
    component: Indexers,
  })
}
