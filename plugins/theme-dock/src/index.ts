// @magpiejs/theme-dock: a theme that replaces components, not only colours. It lays the
// console out with a top bar instead of a sidebar and shows library lists as a table. It
// extends Slate, so it also gets Slate's colours; parts it does not replace (the settings
// layout, the detail and add pages) are the built-in ones.

import type {} from '@magpiejs/themes'
import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'

export const name = 'theme-dock'
export const inject = ['theme', 'webui']

export function apply(ctx: Context) {
  ctx.theme.register({
    id: 'dock',
    name: 'Dock',
    description: 'A top navigation bar and a table-style library list. Builds on Slate.',
    extends: 'slate',
    apiVersion: 1,
    swatch: ['#0f766e', '#eef2f4', '#ffffff', '#17252a'],
  })
  ctx.webui.addEntry({
    baseUrl: import.meta.url,
    source: '../client/index.ts',
    manifest: '../dist/manifest.json',
    routes: [],
  })
}
