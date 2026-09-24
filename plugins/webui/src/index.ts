// @magpiejs/webui: provides the `webui` service from @cordisjs/plugin-webui, but serves
// Magpie's own shell instead of the stock console (no stock pages; docs/PLAN.md §0).
// Pages, widgets and actions come from feature plugins through webui entries.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import NodeWebUI from '@cordisjs/plugin-webui'
import type { Context } from 'cordis'

const appDir = fileURLToPath(new URL('../app', import.meta.url))
const distDir = fileURLToPath(new URL('../dist', import.meta.url))

export class MagpieWebUI extends NodeWebUI {
  static override Config = NodeWebUI.Config

  constructor(ctx: Context, config: NodeWebUI.Config) {
    super(ctx, config)
    if (!config.devMode && !existsSync(distDir + '/manifest.json')) {
      throw new Error(
        'web console is not built; run `npm run build -w @magpiejs/webui` or start with --dev',
      )
    }
    this.root = config.devMode ? appDir : distDir
  }

  // only the shell's own route; everything else is registered by entries
  protected override shellPaths = ['/']
}

export default MagpieWebUI
