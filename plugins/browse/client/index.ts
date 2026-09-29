import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import type { BrowseData } from '../src'
import type { Ref } from 'vue'
import Browse from './browse.vue'

export default function (ctx: Context, data: Ref<BrowseData>) {
  registerPage(ctx, {
    path: '/browse',
    name: 'Browse',
    order: 870,
    component: Browse,
    navigation: { group: 'library', icon: 'browse' },
    disabled: () => !data.value.enabled,
  })
}
