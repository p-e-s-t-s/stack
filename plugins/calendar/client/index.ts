import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import Calendar from './calendar.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'activity', icon: 'calendar' },
    path: '/calendar',
    name: 'Calendar',
    order: 860,
    component: Calendar,
  })
}
