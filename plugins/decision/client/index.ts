import type { Context } from '@cordisjs/client'
import ParseTester from './parse-tester.vue'
import Profiles from './profiles.vue'
import Formats from './formats.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({
    path: '/parse',
    name: 'Parse tester',
    order: 300,
    component: ParseTester,
  })
  ctx.client.router.page({
    path: '/profiles',
    name: 'Quality profiles',
    order: 200,
    component: Profiles,
  })
  ctx.client.router.page({
    path: '/formats',
    name: 'Custom formats',
    order: 100,
    component: Formats,
  })
}
