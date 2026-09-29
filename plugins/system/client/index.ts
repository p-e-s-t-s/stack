import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import SystemPage from './system.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'system', icon: 'activity' },
    path: '/system',
    name: 'Status',
    order: 20,
    component: SystemPage,
  })
}
