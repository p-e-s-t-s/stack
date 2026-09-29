import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import ParseTester from './parse-tester.vue'
import Profiles from './profiles.vue'
import Formats from './formats.vue'
import './style.css'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings' },
    path: '/settings/profiles',
    name: 'Quality profiles',
    order: 80,
    component: Profiles,
  })
  registerPage(ctx, {
    navigation: { group: 'configuration', icon: 'settings' },
    path: '/settings/formats',
    name: 'Custom formats',
    order: 70,
    component: Formats,
  })
  registerPage(ctx, {
    navigation: { group: 'system', icon: 'other' },
    path: '/system/parse',
    name: 'Release name tester',
    order: 10,
    component: ParseTester,
  })
}
