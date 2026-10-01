import type { Context } from '@cordisjs/client'
import { registerRegion } from '@magpiejs/console-kit/theme'
import Palette from './palette.vue'

export default function (ctx: Context) {
  // the shell lays out `shell.topbar`; the palette is a button plus a Ctrl+K overlay
  registerRegion(ctx, 'shell.topbar', Palette, { order: 20 })
}
