import type { Context } from '@cordisjs/client'
import { registerPage } from '@magpiejs/console-kit/navigation'
import MediaTypes from './media-types.vue'
import Plugins from './plugins.vue'
import ProviderSettings from './provider-settings.vue'

export default function (ctx: Context) {
  ctx.client.router.slot({ type: 'provider-settings', component: ProviderSettings })
  // switches shown on Settings → Media management
  ctx.client.router.slot({ type: 'media-types', component: MediaTypes })
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings' },
    path: '/settings/plugins',
    name: 'Plugins',
    // right after General (10)
    order: 9,
    component: Plugins,
  })
}
