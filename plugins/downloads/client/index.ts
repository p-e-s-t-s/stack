import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Activity from './activity.vue'
import Clients from './clients.vue'
import './style.css'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'activity', icon: 'activity' },
    path: '/activity',
    name: 'Activity',
    order: 850,
    component: Activity,
  })
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'activity' },
    path: '/settings/clients',
    name: 'Download clients',
    order: 50,
    component: Clients,
  })
}
