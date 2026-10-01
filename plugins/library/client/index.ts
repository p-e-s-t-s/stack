import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import MediaManagement from './media-management.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', section: 'library', icon: 'books' },
    path: '/settings/media',
    name: 'Media management',
    order: 90,
    component: MediaManagement,
  })
}
