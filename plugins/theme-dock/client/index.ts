import type { Context } from '@cordisjs/client'
import { registerTheme } from '@magpiejs/console-kit/theme'

export default function (ctx: Context) {
  registerTheme(ctx, {
    id: 'dock',
    styles: () => import('./dock.css?inline'),
    // loaded only while Dock is in use
    parts: {
      shell: { load: () => import('./dock-shell.vue') },
      'media.list': { load: () => import('./dock-list.vue') },
    },
  })
}
