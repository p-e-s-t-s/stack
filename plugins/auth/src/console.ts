// Web console entry: General (your password and sessions) for everyone, and Users (accounts,
// roles, API keys) for administrators. The entry's data is shared by every connected
// browser, so it holds only what is the same for all; anything about the caller or about
// other users comes from method calls, which are checked per method.

import type { Context } from 'cordis'
import type AuthService from './index'
import type { ApiKeyInfo, Identity, SessionInfo, UserInfo } from './index'
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
  /** The caller: name, role and permissions. */
  me(): Promise<{
    username: string
    role: Role
    permissions: Permission[]
    sessions: SessionInfo[]
  }>
  changePassword(current: string, next: string): Promise<void>
  revokeSession(id: string): Promise<void>
  revokeOtherSessions(): Promise<void>

  users(): Promise<UserInfo[]>
  createUser(username: string, password: string, role: Role): Promise<void>
  updateUser(id: number, change: { role?: Role; disabled?: boolean }): Promise<void>
  deleteUser(id: number): Promise<void>
  resetPassword(id: number, password: string): Promise<void>
  apiKeys(): Promise<ApiKeyInfo[]>
  /** Returns the new key; it is not shown again. */
  createApiKey(name: string, role: Role): Promise<string>
  revokeApiKey(id: number): Promise<void>
}

const DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including settings, backups, users and API keys.',
  manager: 'Add, change, search and remove media; work the download queue. No settings.',
  viewer: 'Look around: library, calendar, queue and history. Changes nothing.',
}

export default function console_(ctx: Context, auth: AuthService) {
  /** The signed-in user making this call. Call it before the first `await`. */
  const session = () => {
    const who = ctx.webui.caller<Identity>()
    if (who?.type !== 'session') throw new Error('log in again')
    return who
  }

  const data: AuthData = {
    roles: ROLES.map((id) => ({
      id,
      label: ROLE_LABELS[id],
      description: DESCRIPTIONS[id],
      permissions: [...PERMISSIONS[id]],
      key: (KEY_ROLES as readonly string[]).includes(id),
    })),

    async me() {
      const { user, sessionId } = session()
      return {
        username: user.username,
        role: user.role as Role,
        permissions: [...PERMISSIONS[user.role as Role]],
        sessions: auth.sessions(user.id, sessionId),
      }
    },
    async changePassword(current, next) {
      const { user, sessionId } = session()
      await auth.changePassword(user.id, current, next, sessionId)
    },
    async revokeSession(id) {
      auth.revokeSession(session().user.id, id)
    },
    async revokeOtherSessions() {
      const { user, sessionId } = session()
      auth.endSessions(user.id, sessionId)
    },

    async users() {
      return auth.users()
    },
    async createUser(username, password, role) {
      await auth.createUser(username, password, role)
    },
    async updateUser(id, change) {
      auth.updateUser(id, change)
    },
    async deleteUser(id) {
      auth.deleteUser(id, session().user.id)
    },
    async resetPassword(id, password) {
      await auth.resetPassword(id, password)
    },
    async apiKeys() {
      return auth.apiKeys()
    },
    async createApiKey(name, role) {
      return auth.createApiKey(name, { role, userId: session().user.id }).key
    },
    async revokeApiKey(id) {
      auth.revokeApiKey(id)
    },
  }

  ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/general', '/settings/users'],
      access: {
        view: 'account.self',
        methods: {
          users: 'users.manage',
          createUser: 'users.manage',
          updateUser: 'users.manage',
          deleteUser: 'users.manage',
          resetPassword: 'users.manage',
          apiKeys: 'users.manage',
          createApiKey: 'users.manage',
          revokeApiKey: 'users.manage',
        },
      },
    },
    data,
  )
}
