import type { Context } from '@cordisjs/client'
import SystemPage from './system.vue'
import QueueWidget from './queue-widget.vue'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/system', name: 'System', order: 0, component: SystemPage })
  ctx.client.router.slot({ type: 'home-widgets', component: QueueWidget })
}
