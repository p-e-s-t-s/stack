import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import MediaTools from './media-tools.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'other' },
    path: '/settings/media-tools',
    name: 'Media tools',
    order: 95,
    component: MediaTools,
  })
}
