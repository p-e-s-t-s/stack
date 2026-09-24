import type { Context } from '@cordisjs/client'
import Root from './root.vue'
import Home from './home.vue'
import './style.css'

export default function shell(ctx: Context) {
  // @cordisjs/client defaults to zh-CN; follow the browser instead
  const config = ctx.client.setting.original.value
  const preferred = navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'
  if (config.locale !== preferred) config.locale = preferred

  ctx.client.router.slot({ type: 'root', component: Root, order: -1000 })
  ctx.client.router.page({ path: '/', name: 'Home', order: 1000, component: Home })
}
