// Registering and rendering theme parts and regions (docs/themes.md §4.1, §4.4).

import { useContext, useRoute, type Context } from '@cordisjs/client'
import {
  type Component,
  defineAsyncComponent,
  defineComponent,
  h,
  onErrorCaptured,
  shallowReactive,
} from 'vue'
import {
  DEFAULT_THEME,
  regionSlot,
  selectPart,
  type PartCandidate,
  type ThemePartName,
  type ThemeRegionName,
} from '../../src/themes'
import './service'

/** A part, or a loader that is only called when the theme is active. */
export interface LazyPart {
  load: () => Promise<Component | { default: Component }>
}
export type PartSource = Component | LazyPart

export interface ThemeRegistration {
  id: string
  parts: Partial<Record<ThemePartName, PartSource>>
}

type Registered = PartCandidate & { component: Component }

const isLazy = (source: PartSource): source is LazyPart =>
  typeof source === 'object' && source !== null && 'load' in source && !('render' in source)

/**
 * Register a theme's parts. A theme that does not provide a part inherits it from the next
 * theme in the chain, and finally the built-in component.
 */
export function registerTheme(ctx: Context, theme: ThemeRegistration) {
  const disposers = Object.entries(theme.parts).map(([type, source]) =>
    ctx.client.router.slot({
      type,
      component: isLazy(source) ? defineAsyncComponent(source.load as never) : source,
      theme: theme.id,
      disabled: () => !ctx.client.themes?.chain.value.includes(theme.id),
    } as Parameters<typeof ctx.client.router.slot>[0]),
  )
  return () => disposers.forEach((dispose) => dispose())
}

/** Put a small widget in one of the shell's regions. Higher `order` shows first. */
export function registerRegion(
  ctx: Context,
  name: ThemeRegionName,
  component: Component,
  options: { order?: number } = {},
) {
  return ctx.client.router.slot({ type: regionSlot(name), component, order: options.order ?? 0 })
}

/**
 * A component that renders the active theme's version of a part, or `Default` when no theme
 * in the chain provides one. Props, attributes (including listeners) and slots are passed
 * through, so the callers do not know about themes. A theme part that throws while
 * rendering is dropped and the next one in the chain (finally `Default`) takes over.
 */
export function themed(name: ThemePartName, Default: Component): Component {
  return defineComponent({
    name: `Themed(${name})`,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      const ctx = useContext()
      const failed = shallowReactive(new Set<object>())
      let current: object | undefined
      onErrorCaptured((error) => {
        if (!current) return true
        console.error(`theme part "${name}" failed, using the next one`, error)
        failed.add(current)
        return false
      })
      return () => {
        const views = (ctx.client.router.views[name] ?? []) as unknown as Registered[]
        const chain = ctx.client.themes?.chain.value ?? [DEFAULT_THEME]
        const part = selectPart(views, chain, (candidate) => failed.has(candidate))
        current = part
        return h(part?.component ?? Default, attrs, slots)
      }
    },
  })
}

/** Everything plugins contributed to a region, in order; nothing at all when it is empty. */
export const Region = defineComponent({
  name: 'Region',
  inheritAttrs: false,
  props: {
    name: { type: String, required: true },
    /** The wrapper element; empty renders the contributions with no wrapper. */
    tag: { type: String, default: 'div' },
  },
  setup(props, { attrs }) {
    const ctx = useContext()
    return () => {
      const items = [...(ctx.client.router.views[regionSlot(props.name)] ?? [])]
        .filter((item) => !item.disabled?.())
        .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
      if (!items.length) return null
      const children = items.map((item, i) => h(item.component, { key: i }))
      return props.tag ? h(props.tag, attrs, children) : children
    }
  },
})

/** The page the router matched, or the not-found and loading messages. */
export const RoutedPage = defineComponent({
  name: 'RoutedPage',
  setup() {
    const ctx = useContext()
    const route = useRoute()
    return () => {
      const matched = route.matched[0]
      if (matched) return h(matched.component as Component, { key: matched.path })
      return ctx.client.loader.ready.value
        ? h('p', { class: 'mp-empty' }, 'Page not found.')
        : h('p', { class: 'mp-empty', role: 'status' }, 'Loading…')
    }
  },
})
