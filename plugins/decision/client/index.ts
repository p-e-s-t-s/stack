import type { Context } from '@cordisjs/client'
import ParseTester from './parse-tester.vue'
import Profiles from './profiles.vue'
import Formats from './formats.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({
    path: '/settings/profiles',
    name: 'Quality profiles',
    order: 80,
    component: Profiles,
  })
  ctx.client.router.page({
    path: '/settings/formats',
    name: 'Custom formats',
    order: 70,
    component: Formats,
  })
  ctx.client.router.page({
    path: '/system/parse',
    name: 'Release name tester',
    order: 10,
    component: ParseTester,
  })
}
