// Web console entry: General settings (password, API keys).

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { AuthService } from './index'

export interface AuthData {
  username: string
  apiKeys: {
    id: number
    name: string
    prefix: string
    createdAt: number
    lastUsedAt: number | null
  }[]
  changePassword(current: string, next: string): Promise<void>
  /** Returns the new key; it is not shown again. */
  createApiKey(name: string): Promise<string>
  revokeApiKey(id: number): Promise<void>
}

export default function console_(ctx: Context, auth: AuthService) {
  // one login per Magpie; the console's RPC calls come from a logged-in session
  const user = () => auth.users()[0]
  const keys = () =>
    auth.apiKeys().map(({ id, name, prefix, createdAt, lastUsedAt }) => ({
      id,
      name,
      prefix,
      createdAt,
      lastUsedAt,
    }))
  const refresh = () =>
    entry.mutate((d) => {
      d.username = user()?.username ?? ''
      d.apiKeys = keys()
    })

  const data: AuthData = {
    username: user()?.username ?? '',
    apiKeys: keys(),
    async changePassword(current, next) {
      const u = user()
      if (!u) throw new Error('no account yet')
      await auth.changePassword(u.id, current, next)
    },
    async createApiKey(name) {
      const { key } = auth.createApiKey(name)
      refresh()
      return key
    },
    async revokeApiKey(id) {
      auth.revokeApiKey(id)
      refresh()
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/general'],
    },
    data,
  )
}
