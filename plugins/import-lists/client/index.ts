import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import ImportLists from './import-lists.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'other' },
    path: '/settings/import-lists',
    name: 'Import lists',
    order: 65,
    component: ImportLists,
  })
}
