// Web console entry: the General (your account) and Users pages. Everything about a
// particular user (their sessions, the user list, API keys) is served by routes.ts and
// fetched by the pages, because entry data is the same for every browser. All the entry
// carries is what is the same for everyone: the roles.

import type { Context } from 'cordis'
import type AuthService from './index'
import {
  KEY_ROLES,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
} from './permissions'

export interface RoleInfo {
  id: Role
  label: string
  description: string
  permissions: Permission[]
  /** Whether an API key may have this role. */
  key: boolean
}

export interface ProviderInfo {
  id: string
  label: string
  /** Whether it keeps passwords, which the pages then offer to set and change. */
  password: boolean
}

export interface AuthData {
  roles: RoleInfo[]
  /** The identity providers that are loaded. */
  providers: ProviderInfo[]
}

const DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including settings, backups, users and API keys.',
  manager: 'Add, change, search and remove media; work the download queue. No settings.',
  viewer: 'Look around: library, calendar, queue and history. Changes nothing.',
}

export default function console_(ctx: Context, auth: AuthService) {
  const providers = (): ProviderInfo[] =>
    auth.providers.list().map((p) => ({ id: p.id, label: p.label, password: !!p.password }))
  const data: AuthData = {
    providers: providers(),
    roles: ROLES.map((id) => ({
      id,
      label: ROLE_LABELS[id],
      description: DESCRIPTIONS[id],
      permissions: [...PERMISSIONS[id]],
      key: (KEY_ROLES as readonly string[]).includes(id),
    })),
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/general', '/settings/users'],
      access: { view: 'account.self' },
    },
    data,
  )

  ctx.effect(
    () => auth.providers.onChange(() => entry.mutate((d) => void (d.providers = providers()))),
    'auth: tell the console which providers are loaded',
  )
}
