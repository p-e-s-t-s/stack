import type { Context } from '@cordisjs/client'
import ProviderSettings from './provider-settings.vue'

export default function (ctx: Context) {
  ctx.client.router.slot({ type: 'provider-settings', component: ProviderSettings })
}
