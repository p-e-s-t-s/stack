import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import ImportPage from './import.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    path: '/import',
    name: 'Import',
    order: 600,
    component: ImportPage,
    navigation: { group: 'activity', icon: 'activity' },
  })
}
