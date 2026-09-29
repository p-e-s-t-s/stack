import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Indexers from './indexers.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'other' },
    path: '/settings/indexers',
    name: 'Indexers',
    order: 60,
    component: Indexers,
  })
}
