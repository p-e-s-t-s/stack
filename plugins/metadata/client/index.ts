import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Metadata from './metadata.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'other' },
    path: '/settings/metadata',
    name: 'Metadata',
    order: 40,
    component: Metadata,
  })
}
