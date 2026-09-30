import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Health from './health.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'system', icon: 'activity' },
    path: '/system/health',
    name: 'Health',
    order: 10,
    component: Health,
  })
}
