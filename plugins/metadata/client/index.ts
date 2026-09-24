import type { Context } from '@cordisjs/client'
import Metadata from './metadata.vue'

export default function (ctx: Context) {
  ctx.client.router.page({
    path: '/settings/metadata',
    name: 'Metadata',
    order: -130,
    component: Metadata,
  })
}
