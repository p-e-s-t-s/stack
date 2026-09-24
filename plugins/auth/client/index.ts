import type { Context } from '@cordisjs/client'
import General from './general.vue'

export default function (ctx: Context) {
  ctx.client.router.page({
    path: '/settings/general',
    name: 'General',
    order: 10,
    component: General,
  })
}
