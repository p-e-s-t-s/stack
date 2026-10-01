import type { Context } from '@cordisjs/client'
import { setCaller } from '@magpiejs/console-kit/access'
import Root from './root.vue'
import Home from './home.vue'
import './style.css'

export default function shell(ctx: Context) {
  // @cordisjs/client defaults to zh-CN; follow the browser instead
  const config = ctx.client.setting.original.value
  const preferred = navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'
  if (config.locale !== preferred) config.locale = preferred

  // the server says who is signed in and what they may do, so pages can hide
  ctx.on('caller' as any, (body: any) => setCaller(body))

  ctx.client.router.slot({ type: 'root', component: Root, order: -1000 })
  ctx.client.router.page({
    path: '/',
    name: 'Home',
    order: 1000,
    component: Home,
    disabled: () => true,
  })
}
