import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import CheckBadge from './check-badge.vue'
import ImportChecks from './import-checks.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'other' },
    path: '/settings/import-checks',
    permission: 'settings.manage',
    name: 'Import checks',
    order: 96,
    component: ImportChecks,
  })
  // shown on each row of Activity by the downloads plugin's `activity-row` slot
  ctx.client.router.slot({ type: 'activity-row', component: CheckBadge, order: 10 })
}
