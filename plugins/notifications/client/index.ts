import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Notifications from './notifications.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', section: 'connections', icon: 'other' },
    path: '/settings/notifications',
    name: 'Notifications',
    order: 70,
    component: Notifications,
  })
}
