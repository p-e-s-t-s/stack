import type { Context } from '@cordisjs/client'
import MediaManagement from './media-management.vue'

export default function (ctx: Context) {
  ctx.client.router.page({
    path: '/settings/media',
    name: 'Media management',
    order: -100,
    component: MediaManagement,
  })
}
