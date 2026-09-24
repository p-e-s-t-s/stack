import type { Context } from '@cordisjs/client'
import SystemPage from './system.vue'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/system', name: 'Status', order: 20, component: SystemPage })
}
