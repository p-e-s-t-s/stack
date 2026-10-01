import type { Context } from '@cordisjs/client'
import { registerTheme } from '@magpiejs/console-kit/theme'

export default function (ctx: Context) {
  // no parts: only styles, loaded when Slate is in use
  registerTheme(ctx, { id: 'slate', styles: () => import('./slate.css?inline') })
}
