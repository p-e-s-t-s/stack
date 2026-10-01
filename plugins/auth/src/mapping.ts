// Turning the groups an identity provider reports into a Magpie role. Shared by the
// providers that learn groups (a proxy's header, an OpenID claim).

import type { Role } from './permissions'
import z from 'schemastery'

export interface RoleRules {
  /** Groups whose members are administrators. */
  adminGroups: string[]
  /** Groups whose members are managers. */
  managerGroups: string[]
  /** Everyone else. `none` refuses them. */
  defaultRole: Role | 'none'
}

/** The config fields for `RoleRules`, to put in a provider's `Config`. */
export function roleRulesSchema(defaultRole: RoleRules['defaultRole'] = 'viewer') {
  return {
    adminGroups: z
      .array(String)
      .default([])
      .description('Groups whose members are administrators.'),
    managerGroups: z.array(String).default([]).description('Groups whose members are managers.'),
    defaultRole: z
      .union([z.const('viewer'), z.const('manager'), z.const('admin'), z.const('none')])
      .default(defaultRole)
      .description('The role of everyone else. `none` lets in only the groups above.'),
  }
}

/** The highest role the groups earn, or `undefined` if the rules let them in at no role. */
export function roleFromGroups(groups: readonly string[], rules: RoleRules): Role | undefined {
  const has = (wanted: string[]) => wanted.some((g) => groups.includes(g))
  if (has(rules.adminGroups)) return 'admin'
  if (has(rules.managerGroups)) return 'manager'
  return rules.defaultRole === 'none' ? undefined : rules.defaultRole
}
