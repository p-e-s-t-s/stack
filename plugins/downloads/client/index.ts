import type { Context } from '@cordisjs/client'
import Activity from './activity.vue'
import Clients from './clients.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/activity', name: 'Activity', order: 850, component: Activity })
  ctx.client.router.page({
    path: '/settings/clients',
    name: 'Download clients',
    order: 50,
    component: Clients,
  })
}
