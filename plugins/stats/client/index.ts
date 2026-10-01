import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Stats from './stats.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'activity', icon: 'activity' },
    path: '/stats',
    name: 'Statistics',
    order: 830,
    component: Stats,
  })
}
