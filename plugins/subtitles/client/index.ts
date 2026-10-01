import type { Context } from '@cordisjs/client'
import { registerPage } from '@magpiejs/console-kit/navigation'
import Wanted from './wanted.vue'
import Settings from './settings.vue'
import Detail from './detail.vue'

export default function(ctx:Context) {
  registerPage(ctx,{path:'/subtitles',name:'Subtitles',order:840,component:Wanted,navigation:{group:'activity',icon:'other'}})
  registerPage(ctx,{path:'/settings/subtitles',permission:'settings.manage',name:'Subtitles',order:55,component:Settings,navigation:{group:'configuration',icon:'other'}})
  ctx.client.router.slot({type:'movie-detail',component:Detail})
  ctx.client.router.slot({type:'series-detail',component:Detail})
}
