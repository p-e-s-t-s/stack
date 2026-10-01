// The client-side theme state, one per console: which theme chain is active. It hangs off
// `ctx.client.themes`, like Cordis's own `router` and `loader`, so every plugin entry reaches
// the same instance however many copies of console-kit were bundled (docs/themes.md §4.6).

import { ref } from 'vue'
import { DEFAULT_THEME } from '../../src/themes'

declare module '@cordisjs/client' {
  interface ClientService {
    themes: ThemeClient
  }
}

export class ThemeClient {
  /** Active themes, most specific first; always ends in the default theme. */
  readonly chain = ref<string[]>([DEFAULT_THEME])

  setChain(chain: readonly string[]) {
    const unique = [...new Set(chain)].filter((id) => id !== DEFAULT_THEME)
    this.chain.value = [...unique, DEFAULT_THEME]
  }
}
