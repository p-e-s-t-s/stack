import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Backups from './backups.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'system', icon: 'activity' },
    path: '/system/backups',
    name: 'Backups',
    order: 15,
    component: Backups,
  })
}
