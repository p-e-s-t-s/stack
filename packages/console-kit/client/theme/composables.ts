// What a custom shell builds on, so it gets the console's navigation and accessibility
// behaviour without copying them (docs/themes.md §4.2). Setup-only, like Cordis's own.

import { useContext, useRoute, useRouter } from '@cordisjs/client'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { activePage, href, isSettings, navigation, type NavPage } from '../../src/navigation'

/** Navigation groups, the active page and links. Themes draw it; they do not compute it. */
export function useNavigation() {
  const ctx = useContext()
  const route = useRoute()
  const router = useRouter()
  const model = computed(() =>
    navigation(Object.values(ctx.client.router.pages) as unknown as NavPage[]),
  )
  const active = computed(() => activePage(model.value.pages, route.path))
  const inSettings = computed(() => isSettings(active.value))

  /** Client-side navigation for a plain click; false (and no-op) for new-tab clicks etc. */
  function navigate(event: MouseEvent, path: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) {
      return false
    }
    event.preventDefault()
    void router.push(path)
    return true
  }

  return { model, active, inSettings, href, navigate }
}

/** Whether the console has loaded and whether the server connection is up. */
export function useConnection() {
  const ctx = useContext()
  return {
    ready: computed(() => ctx.client.loader.ready.value),
    connected: computed(() => !!ctx.client.socket.value),
  }
}

/** The same mobile/desktop switch the default shell uses (`min-width: 721px`). */
export function useBreakpoint() {
  const query = window.matchMedia('(min-width: 721px)')
  const isDesktop = ref(query.matches)
  const update = () => (isDesktop.value = query.matches)
  onMounted(() => query.addEventListener('change', update))
  onUnmounted(() => query.removeEventListener('change', update))
  return { isDesktop }
}

/**
 * A navigation drawer with focus management: opening focuses the close button, closing
 * returns focus to the menu button, Escape closes, Tab stays inside, and it closes on route
 * change and when the viewport becomes desktop. Bind `menuButton`, `closeButton` and
 * `navElement` as template refs, and `onKeydown` on the nav.
 */
export function useDrawer() {
  const route = useRoute()
  const { isDesktop } = useBreakpoint()
  const open = ref(false)
  const menuButton = ref<HTMLButtonElement>()
  const closeButton = ref<HTMLButtonElement>()
  const navElement = ref<HTMLElement>()

  async function openDrawer() {
    open.value = true
    await nextTick()
    closeButton.value?.focus()
  }
  function closeDrawer() {
    open.value = false
    menuButton.value?.focus()
  }
  function onKeydown(event: KeyboardEvent) {
    if (!open.value) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDrawer()
      return
    }
    if (event.key !== 'Tab') return
    const controls = [
      ...(navElement.value?.querySelectorAll<HTMLElement>('a[href], button') ?? []),
    ].filter((el) => el.getClientRects().length)
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  watch(
    () => route.path,
    () => {
      if (open.value) closeDrawer()
    },
  )
  watch(isDesktop, (desktop) => {
    if (desktop) open.value = false
  })

  return { open, menuButton, closeButton, navElement, openDrawer, closeDrawer, onKeydown }
}
