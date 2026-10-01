// Web console entry: the Appearance page, and keeping this tab's theme in step with the
// server. The list of themes is the same for everyone and rides on the entry data; a user's
// own choice does not, so the page asks `/themes` for it.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { ThemeInfo, ThemesService } from './index'

export interface ThemesData {
  themes: ThemeInfo[]
  /** Counts every change, so consoles know when to ask for their own chain again. */
  version: number
}

export default function console_(ctx: Context, themes: ThemesService) {
  let version = 0
  const snapshot = (): ThemesData => ({ themes: themes.list(), version })
  ctx.on('theme/changed', () => {
    version++
    entry.mutate((d) => Object.assign(d, snapshot()))
  })

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/appearance'],
      // everyone picks their own theme, and every tab follows the chain the server gives it
      access: { view: 'account.self' },
    },
    snapshot(),
  )
}
