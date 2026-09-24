// Web console entry: the provider settings component shown on the Indexers, Download
// clients and Metadata pages (slot `provider-settings`, with `{ kind }`).

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { Provider, ProviderEntry, SettingsService } from './index'

export interface SettingsData {
  providers: Provider[]
  entries: ProviderEntry[]
  add(name: string, config: Record<string, unknown>, enabled: boolean): Promise<void>
  update(id: string, config: Record<string, unknown>, enabled: boolean): Promise<void>
  remove(id: string): Promise<void>
}

export default function console_(ctx: Context, settings: SettingsService) {
  const data: SettingsData = {
    providers: settings.providers(),
    entries: settings.entries(),
    async add(name, config, enabled) {
      await settings.add(name, config, enabled)
    },
    update: (id, config, enabled) => settings.update(id, config, enabled),
    async remove(id) {
      settings.remove(id)
    },
  }
  ctx.on('settings/changed', () => entry.mutate((d) => (d.entries = settings.entries())))

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/indexers', '/settings/clients', '/settings/metadata'],
    },
    data,
  )
}
