import type { Context } from '@cordisjs/client'
import { registerPage } from '@magpiejs/console-kit/navigation'
import { watch } from 'vue'
import Appearance from './appearance.vue'
import { fetchThemes } from './sync'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings' },
    path: '/settings/appearance',
    name: 'Appearance',
    order: 20,
    component: Appearance,
  })

  // keep this tab's themes in step with the server: a theme was installed or removed, or the
  // default or someone's choice changed
  const entry = ctx.$entry!
  ctx.effect(() =>
    watch(
      () => (entry.data.value as { version: number }).version,
      () =>
        void fetchThemes().then(
          (state) => ctx.client.themes.apply(state.chain),
          () => {},
        ),
    ),
  )
}
