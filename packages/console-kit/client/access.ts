// What the signed-in user may do, as the server reports it. The server sends a `caller`
// message when the console connects. Hiding a page for someone who cannot use it is only
// politeness: the server checks every method and route itself.

import type { Permission } from '@magpiejs/types'
import { type Ref, ref } from 'vue'

export interface Caller {
  username: string
  role: string
  permissions: Permission[]
}

// Each plugin's console bundle gets its own copy of this module, but they must all see the
// one the shell sets, so the state lives on `globalThis`.
const KEY = Symbol.for('magpie.console.caller')
const shared = globalThis as unknown as Record<symbol, Ref<Caller | undefined> | undefined>
const current = (shared[KEY] ??= ref<Caller>())

export function setCaller(caller: Caller | undefined) {
  current.value = caller
}

/** Who is signed in, once the server has said. */
export const caller = current

/** True until the server says who is signed in, so pages don't flicker away on load. */
export function can(permission: Permission) {
  return !current.value || current.value.permissions.includes(permission)
}
