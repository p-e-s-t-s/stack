import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import MediaServers from './media-servers.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'other' },
    path: '/settings/media-servers',
    name: 'Media servers',
    order: 75,
    component: MediaServers,
  })
}
