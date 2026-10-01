import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import { registerRegion } from '@magpiejs/console-kit/theme'
import General from './general.vue'
import Logout from './logout.vue'

export default function (ctx: Context) {
  // the console's Log out button: the shell lays out `shell.nav-foot`, auth fills it
  registerRegion(ctx, 'shell.nav-foot', Logout)
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings', default: true },
    path: '/settings/general',
    name: 'General',
    order: 10,
    component: General,
  })
}
