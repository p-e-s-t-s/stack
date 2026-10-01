// Roles and what they may do. Plugins name a permission; this table decides who has it.
// Roles are fixed in code, so a user row stores only the role name.

import type { Permission, Role } from '@magpiejs/types'

export type { Permission, Role }

export const ROLES = ['admin', 'manager', 'viewer'] as const satisfies readonly Role[]

const VIEWER: readonly Permission[] = ['account.self', 'library.read']
const MANAGER: readonly Permission[] = [...VIEWER, 'library.write', 'downloads.manage']
const ADMIN: readonly Permission[] = [...MANAGER, 'settings.manage', 'system.admin', 'users.manage']

export const PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  viewer: new Set(VIEWER),
  manager: new Set(MANAGER),
  admin: new Set(ADMIN),
}

/** Roles an API key may have: a key never administers. */
export const KEY_ROLES = ['viewer', 'manager'] as const satisfies readonly Role[]

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Administrator',
  manager: 'Manager',
  viewer: 'Viewer',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** An unknown role gets nothing, so a bad row can never grant access. */
export function roleCan(role: string, permission: Permission) {
  return isRole(role) && PERMISSIONS[role].has(permission)
}

/** Whether `role` has no more access than `cap` (admin > manager > viewer). */
export function roleAtMost(role: Role, cap: Role) {
  return ROLES.indexOf(role) >= ROLES.indexOf(cap)
}
