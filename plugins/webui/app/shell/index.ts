import type { Context } from '@cordisjs/client'
import { registerRegion, ThemeClient } from '@magpiejs/console-kit/theme'
import Root from './root.vue'
import Home from './home.vue'
import OfflineNotice from './offline-notice.vue'
import SettingsLink from './settings-link.vue'
import './style.css'

/** The chain last used on this device, so the first paint already has the right theme. */
const MIRROR = 'magpie.theme.chain'

function readMirror(): string[] | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(MIRROR) ?? 'null')
    return Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : undefined
  } catch {
    return undefined
  }
}

/** Remember the chain for the next first paint. */
export function mirrorChain(chain: readonly string[]) {
  try {
    localStorage.setItem(MIRROR, JSON.stringify(chain))
  } catch {
    // private mode: the first paint just uses the default
  }
}

/** This tab's theme: the stored chain, then the server's answer. `?theme=default` skips both. */
async function loadChain(themes: ThemeClient) {
  if (new URLSearchParams(location.search).get('theme') === 'default') return
  const mirrored = readMirror()
  if (mirrored) themes.setChain(mirrored)
  try {
    const res = await fetch('/themes', { credentials: 'same-origin' })
    if (!res.ok) return // no themes plugin: the default
    const body = (await res.json()) as { chain: string[] }
    themes.setChain(body.chain)
    mirrorChain(themes.chain.value)
  } catch {
    // offline: keep what we have
  }
}

export default function shell(ctx: Context) {
  // @cordisjs/client defaults to zh-CN; follow the browser instead
  const config = ctx.client.setting.original.value
  const preferred = navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'
  if (config.locale !== preferred) config.locale = preferred

  ctx.client.themes = new ThemeClient()
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
