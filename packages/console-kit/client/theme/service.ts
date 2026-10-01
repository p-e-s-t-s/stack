// The client-side theme state, one per console: which theme chain is active. It hangs off
// `ctx.client.themes`, like Cordis's own `router` and `loader`, so every plugin entry reaches
// the same instance however many copies of console-kit were bundled (docs/themes.md §4.6).

import { type Component, ref, shallowReactive, watch } from 'vue'
import { DEFAULT_THEME } from '../../src/themes'

declare module '@cordisjs/client' {
  interface ClientService {
    themes: ThemeClient
  }
}

/** The chain last used on this device, so the first paint already has the right theme. */
const MIRROR = 'magpie.theme.chain'

export class ThemeClient {
  /** Active themes, most specific first; always ends in the default theme. */
  readonly chain = ref<string[]>([DEFAULT_THEME])
  /** `?theme=default`: this tab shows the built-in look and ignores the server's answer. */
  readonly safeMode = new URLSearchParams(location.search).get('theme') === 'default'
  /** The built-in component of each part, registered by the engine; see `Part`. */
  readonly defaults = shallowReactive(new Map<string, Component>())
  /** CSS of installed themes, loaded only while a theme is in the chain. */
  readonly styles = shallowReactive(new Map<string, () => Promise<string>>())
  private loaded = new Map<string, Promise<string>>()

  constructor() {
    if (this.safeMode) return
    try {
      const value = JSON.parse(localStorage.getItem(MIRROR) ?? 'null')
      if (Array.isArray(value) && value.every((id) => typeof id === 'string')) this.setChain(value)
    } catch {
      // no storage, or junk in it: start with the default
    }
  }

  setChain(chain: readonly string[]) {
    const unique = [...new Set(chain)].filter((id) => id !== DEFAULT_THEME)
    this.chain.value = [...unique, DEFAULT_THEME]
  }

  /** Use the chain the server resolved, and remember it for the next first paint. */
  apply(chain: readonly string[]) {
    if (this.safeMode) return
    this.setChain(chain)
    try {
      localStorage.setItem(MIRROR, JSON.stringify(this.chain.value))
    } catch {
      // private mode: the next first paint just uses the default
    }
  }

  /**
   * Keep one `<style>` holding the CSS of the active themes, parents first, inside the
   * `theme` cascade layer; and `data-theme` on `<html>` for CSS that targets a theme.
   * Returns a function that undoes it.
   */
  mountStyles() {
    const element = document.createElement('style')
    element.dataset.magpieThemes = ''
    document.head.append(element)
    let run = 0
    const stop = watch(
      [this.chain, () => [...this.styles.keys()].join()],
      async () => {
        const mine = ++run
        const chain = this.chain.value
        document.documentElement.dataset.theme = chain[0]
        const ids = [...chain].reverse().filter((id) => this.styles.has(id))
        const css = await Promise.all(ids.map((id) => this.css(id)))
        if (mine !== run) return // the chain changed again while loading
        element.textContent = css.length ? `@layer theme {\n${css.join('\n')}\n}` : ''
      },
      { immediate: true },
    )
    return () => {
      stop()
      element.remove()
      delete document.documentElement.dataset.theme
    }
  }

  private css(id: string) {
    let css = this.loaded.get(id)
    if (!css) {
      css = this.styles.get(id)!().catch((error) => {
        console.error(`theme "${id}" styles failed to load`, error)
        return ''
      })
      this.loaded.set(id, css)
    }
    return css
  }
}
