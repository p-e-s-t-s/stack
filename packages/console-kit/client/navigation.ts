import type { Activity, Context } from '@cordisjs/client'
import type { PageNavigation } from '../src/navigation'

declare module '@cordisjs/client' {
  // Cordis exposes page options in this namespace; augment its existing contract.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Activity {
    interface Options {
      navigation?: PageNavigation
    }
  }
}

/** Register a visible page with explicit Magpie navigation metadata. */
export function registerPage(
  ctx: Context,
  options: Activity.Options & { navigation: PageNavigation },
) {
  return ctx.client.router.page(options)
}
