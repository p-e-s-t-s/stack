import type { Activity, Context } from '@cordisjs/client'
import type { Permission } from '@magpiejs/types'
import type { PageNavigation } from '../src/navigation'
import { can } from './access'

declare module '@cordisjs/client' {
  // Cordis exposes page options in this namespace; augment its existing contract.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Activity {
    interface Options {
      navigation?: PageNavigation
      /** Hides the page from people without it. The server enforces access itself. */
      permission?: Permission
    }
  }
}

/** Register a visible page with explicit Magpie navigation metadata. */
export function registerPage(
  ctx: Context,
  options: Activity.Options & { navigation: PageNavigation },
) {
  const { permission, disabled } = options
  return ctx.client.router.page({
    ...options,
    disabled: permission ? () => !can(permission) || disabled?.() : disabled,
  })
}
