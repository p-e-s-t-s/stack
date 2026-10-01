import type { Context } from '@cordisjs/client'
import { setCaller } from '@magpiejs/console-kit/access'
import { registerRegion, ThemeClient } from '@magpiejs/console-kit/theme'
import Root from './root.vue'
import Home from './home.vue'
import OfflineNotice from './offline-notice.vue'
import { DefaultSettingsLayout } from './parts'
import SettingsLink from './settings-link.vue'
import './style.css'

/** Ask the server which themes apply to this user; no themes plugin means the default. */
async function loadChain(themes: ThemeClient) {
  try {
    const res = await fetch('/themes', { credentials: 'same-origin' })
    if (res.ok) themes.apply(((await res.json()) as { chain: string[] }).chain)
  } catch {
    // offline: keep what we have
  }
}

export default function shell(ctx: Context) {
  // @cordisjs/client defaults to zh-CN; follow the browser instead
  const config = ctx.client.setting.original.value
  const preferred = navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'
  if (config.locale !== preferred) config.locale = preferred

  // the server says who is signed in and what they may do, so pages can hide
  ctx.on('caller' as any, (body: any) => setCaller(body))

  ctx.client.themes = new ThemeClient()
  ctx.effect(() => ctx.client.themes.mountStyles())
  ctx.client.themes.defaults.set('settings.layout', DefaultSettingsLayout)
  void loadChain(ctx.client.themes)

  // `root` is the engine's, not a theme part (docs/themes.md §3.2): pinned to the top order
  // so nothing else wins. Themes change the frame through the `shell` part.
  ctx.client.router.slot({ type: 'root', component: Root, order: Number.MAX_SAFE_INTEGER })
  registerRegion(ctx, 'shell.notices', OfflineNotice)
  registerRegion(ctx, 'shell.nav-foot', SettingsLink, { order: 100 })
  ctx.client.router.page({
    path: '/',
    name: 'Home',
    order: 1000,
    component: Home,
    disabled: () => true,
  })
}
