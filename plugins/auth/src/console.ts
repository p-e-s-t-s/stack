// Web console entry: the General (your account) and Users pages. Everything about a
// particular user (their sessions, the user list, API keys) is served by routes.ts and
// fetched by the pages, because entry data is the same for every browser. All the entry
// carries is what is the same for everyone: the roles.

import type { Context } from 'cordis'
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

export interface AuthData {
  roles: RoleInfo[]
}

const DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including settings, backups, users and API keys.',
  manager: 'Add, change, search and remove media; work the download queue. No settings.',
  viewer: 'Look around: library, calendar, queue and history. Changes nothing.',
}

export default function console_(ctx: Context) {
  const data: AuthData = {
    roles: ROLES.map((id) => ({
      id,
      label: ROLE_LABELS[id],
      description: DESCRIPTIONS[id],
      permissions: [...PERMISSIONS[id]],
      key: (KEY_ROLES as readonly string[]).includes(id),
    })),
  }

  ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/general', '/settings/users'],
      access: { view: 'account.self' },
    },
    data,
  )
}
