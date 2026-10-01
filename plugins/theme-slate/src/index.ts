// @magpiejs/theme-slate: a partial theme. It changes colours, corners and type through the
// console's tokens and replaces no component, so everything else is the built-in look.

import type {} from '@magpiejs/themes'
import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'

export const name = 'theme-slate'
export const inject = ['theme', 'webui']

export function apply(ctx: Context) {
  ctx.theme.register({
    id: 'slate',
    name: 'Slate',
    description: 'Cooler colours, rounder corners and a serif heading. Colours and type only.',
    apiVersion: 1,
    swatch: ['#eef2f4', '#ffffff', '#0f766e', '#134e4a'],
  })
  ctx.webui.addEntry({
    baseUrl: import.meta.url,
    source: '../client/index.ts',
    manifest: '../dist/manifest.json',
    routes: [],
    // a theme's styles are for everyone, whatever their role
    access: { view: 'account.self' },
  })
}
