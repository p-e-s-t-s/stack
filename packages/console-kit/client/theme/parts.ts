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
  parts?: Partial<Record<ThemePartName, PartSource>>
  /**
   * The theme's CSS: tokens (`--mp-*` custom properties) and rules for the `.mp-*` classes. It is
   * applied inside the `theme` cascade layer while the theme is in the chain; a loader such
   * as `() => import('./theme.css?inline')` keeps it off the wire until then.
   */
  styles?: string | (() => Promise<string | { default: string }>)
}

type Registered = PartCandidate & { component: Component }

const isLazy = (source: PartSource): source is LazyPart =>
  typeof source === 'object' && source !== null && 'load' in source && !('render' in source)

/**
 * Register a theme's parts and styles. A theme that does not provide a part inherits it from
 * the next theme in the chain, and finally the built-in component.
 */
export function registerTheme(ctx: Context, theme: ThemeRegistration) {
  const { styles } = theme
  if (styles) {
    const load = async () => {
      const css = typeof styles === 'string' ? styles : await styles()
      return typeof css === 'string' ? css : css.default
    }
    ctx.effect(() => {
      ctx.client.themes.styles.set(theme.id, load)
      return () => ctx.client.themes.styles.delete(theme.id)
    })
  }
  const disposers = Object.entries(theme.parts ?? {}).map(([type, source]) =>
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

/** The registration to render for a part, or undefined for the built-in. */
function pick(ctx: Context, name: string, failed: Set<object>) {
  const views = (ctx.client.router.views[name] ?? []) as unknown as Registered[]
  const chain = ctx.client.themes?.chain.value ?? [DEFAULT_THEME]
  return selectPart(views, chain, (candidate) => failed.has(candidate))
}

/** Remember a theme part that threw while rendering, so the next one takes over. */
function dropOnError(name: () => string, current: () => object | undefined, failed: Set<object>) {
  onErrorCaptured((error) => {
    const part = current()
    if (!part) return true // the built-in itself failed: not ours to hide
    console.error(`theme part "${name()}" failed, using the next one`, error)
    failed.add(part)
    return false
  })
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
      dropOnError(
        () => name,
        () => current,
        failed,
      )
      return () => {
        const part = (current = pick(ctx, name, failed))
        return h(part?.component ?? Default, attrs, slots)
      }
    },
  })
}

/**
 * `<Part name="settings.layout">`: renders a part by name, for shells that need to place
 * another part. The built-in comes from the engine's registry (`ctx.client.themes.defaults`).
 */
export const Part = defineComponent({
  name: 'Part',
  inheritAttrs: false,
  props: { name: { type: String, required: true } },
  setup(props, { attrs, slots }) {
    const ctx = useContext()
    const failed = shallowReactive(new Set<object>())
    let current: object | undefined
    dropOnError(
      () => props.name,
      () => current,
      failed,
    )
    return () => {
      const part = (current = pick(ctx, props.name, failed))
      const component = part?.component ?? ctx.client.themes.defaults.get(props.name)
      return component ? h(component, attrs, slots) : null
    }
  },
})

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
