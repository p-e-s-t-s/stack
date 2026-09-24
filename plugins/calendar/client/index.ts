import type { Context } from '@cordisjs/client'
import Calendar from './calendar.vue'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/calendar', name: 'Calendar', order: 860, component: Calendar })
}
