import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import General from './general.vue'
import Users from './users.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings', default: true },
    path: '/settings/general',
    name: 'General',
    order: 10,
    component: General,
  })
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings' },
    path: '/settings/users',
    name: 'Users',
    order: 11,
    permission: 'users.manage',
    component: Users,
  })
}
