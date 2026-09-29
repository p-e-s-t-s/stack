<template>
  <div class="mp-shell">
    <a class="mp-skip" href="#mp-main">Skip to content</a>
    <header class="mp-mobile-bar">
      <button
        ref="menuButton"
        class="mp-icon-button"
        aria-label="Open navigation"
        :aria-expanded="drawerOpen"
        aria-controls="mp-navigation"
        @click="openDrawer"
      >
        <NavIcon name="menu" />
      </button>
      <span class="mp-brand">Magpie<span class="mp-brand-dot">.</span></span>
      <span class="mp-muted">{{ inSettings ? 'Settings' : active?.name }}</span>
    </header>
    <div v-if="drawerOpen" class="mp-nav-backdrop" @click="closeDrawer" />
    <nav
      id="mp-navigation"
      ref="navElement"
      class="mp-nav"
      :class="{ 'is-open': drawerOpen }"
      aria-label="Main navigation"
      @keydown="onNavKeydown"
    >
      <div class="mp-brand">
        Magpie<span class="mp-brand-dot">.</span
        ><span class="mp-brand-caption">YOUR MEDIA, TOGETHER</span>
      </div>
      <button
        ref="closeButton"
        class="mp-icon-button mp-nav-close"
        aria-label="Close navigation"
        @click="closeDrawer"
      >
        <NavIcon name="close" />
      </button>
      <div class="mp-nav-links">
        <section v-for="group in model.groups" :key="group.name">
          <h2 class="mp-nav-group">{{ group.name }}</h2>
          <a
            v-for="page in group.pages"
            :key="page.id"
            :href="href(page)"
            :class="{ active: page === active }"
            :aria-current="page === active ? 'page' : undefined"
            @click="navigate($event, href(page))"
          >
            <NavIcon :name="page.navigation?.icon ?? 'other'" /><span>{{ page.name }}</span>
          </a>
        </section>
      </div>
      <div class="mp-nav-foot">
        <a
          v-if="model.destination"
          :href="href(model.destination)"
          :class="{ active: inSettings }"
          :aria-current="inSettings ? 'true' : undefined"
          @click="navigate($event, href(model.destination))"
          ><NavIcon name="settings" /><span>Settings</span></a
        >
        <form method="post" action="/auth/logout">
          <button type="submit" class="mp-logout">
            <NavIcon name="logout" /><span>Log out</span>
          </button>
        </form>
      </div>
    </nav>
    <main id="mp-main" class="mp-main" tabindex="-1" :inert="drawerOpen || undefined">
      <div v-if="ready && !connected" class="mp-offline" role="status">
        Lost the connection to Magpie. Reconnecting…
      </div>
      <div class="mp-content" :class="{ 'mp-content-settings': inSettings }">
        <div v-if="inSettings" class="mp-settings-heading">
          <span class="mp-eyebrow">WORKSPACE</span>
          <h1>Settings</h1>
          <p class="mp-muted">Manage your library, connections, and system.</p>
        </div>
        <div :class="{ 'mp-settings-layout': inSettings }">
          <nav v-if="inSettings" class="mp-settings-nav" aria-label="Settings navigation">
            <section v-for="group in model.settings" :key="group.name">
              <h2 class="mp-nav-group">{{ group.name }}</h2>
              <a
                v-for="page in group.pages"
                :key="page.id"
                :href="href(page)"
                :class="{ active: page === active }"
                :aria-current="page === active ? 'page' : undefined"
                @click="navigate($event, href(page))"
                >{{ page.name }}</a
              >
            </section>
          </nav>
          <div class="mp-page">
            <component :is="matched.component" v-if="matched" :key="matched.path" />
            <p v-else-if="ready" class="mp-empty">Page not found.</p>
            <p v-else class="mp-empty" role="status">Loading…</p>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useContext, useRoute, useRouter } from '@cordisjs/client'
import type {} from '@magpiejs/console-kit/navigation'
import { activePage, href, isSettings, navigation } from './navigation'
import NavIcon from './nav-icon.vue'

const ctx = useContext()
const route = useRoute()
const router = useRouter()
const model = computed(() => navigation(Object.values(ctx.client.router.pages)))
const active = computed(() => activePage(model.value.pages, route.path))
const inSettings = computed(() => isSettings(active.value))
const matched = computed(() => route.matched[0])
const ready = computed(() => ctx.client.loader.ready.value)
const connected = computed(() => !!ctx.client.socket.value)
const drawerOpen = ref(false)
const menuButton = ref<HTMLButtonElement>()
const closeButton = ref<HTMLButtonElement>()
const navElement = ref<HTMLElement>()

watchEffect(() => {
  if (route.path === '/' && model.value.landing && href(model.value.landing) !== '/') {
    void router.replace(href(model.value.landing))
  }
})
watch(
  () => route.path,
  () => {
    if (drawerOpen.value) closeDrawer()
  },
)

function navigate(event: MouseEvent, path: string) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  if (drawerOpen.value) closeDrawer()
  void router.push(path)
}
async function openDrawer() {
  drawerOpen.value = true
  await nextTick()
  closeButton.value?.focus()
}
function closeDrawer() {
  drawerOpen.value = false
  menuButton.value?.focus()
}
function onNavKeydown(event: KeyboardEvent) {
  if (!drawerOpen.value) return
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
const desktop = window.matchMedia('(min-width: 721px)')
function onDesktop() {
  if (desktop.matches) drawerOpen.value = false
}
onMounted(() => desktop.addEventListener('change', onDesktop))
onUnmounted(() => desktop.removeEventListener('change', onDesktop))
</script>
