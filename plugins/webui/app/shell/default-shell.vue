<template>
  <div class="mp-shell">
    <a class="mp-skip" href="#mp-main">Skip to content</a>
    <header class="mp-mobile-bar">
      <button
        :ref="(el) => (drawer.menuButton.value = el as HTMLButtonElement)"
        class="mp-icon-button"
        aria-label="Open navigation"
        :aria-expanded="drawer.open.value"
        aria-controls="mp-navigation"
        @click="drawer.openDrawer"
      >
        <NavIcon name="menu" />
      </button>
      <span class="mp-brand">Magpie<span class="mp-brand-dot">.</span></span>
      <span class="mp-muted">{{ inSettings ? 'Settings' : active?.name }}</span>
    </header>
    <div v-if="drawer.open.value" class="mp-nav-backdrop" @click="drawer.closeDrawer" />
    <nav
      id="mp-navigation"
      :ref="(el) => (drawer.navElement.value = el as HTMLElement)"
      class="mp-nav"
      :class="{ 'is-open': drawer.open.value }"
      aria-label="Main navigation"
      @keydown="drawer.onKeydown"
    >
      <div class="mp-brand">
        Magpie<span class="mp-brand-dot">.</span
        ><span class="mp-brand-caption">YOUR MEDIA, TOGETHER</span>
      </div>
      <button
        :ref="(el) => (drawer.closeButton.value = el as HTMLButtonElement)"
        class="mp-icon-button mp-nav-close"
        aria-label="Close navigation"
        @click="drawer.closeDrawer"
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
            @click="go($event, href(page))"
          >
            <NavIcon :name="page.navigation?.icon ?? 'other'" /><span>{{ page.name }}</span>
          </a>
        </section>
      </div>
      <Region name="shell.nav-foot" class="mp-nav-foot" />
    </nav>
    <main id="mp-main" class="mp-main" tabindex="-1" :inert="drawer.open.value || undefined">
      <Region name="shell.notices" tag="" />
      <Region name="shell.topbar" class="mp-topbar" />
      <div class="mp-content" :class="{ 'mp-content-settings': inSettings }">
        <SettingsLayout v-if="inSettings">
          <div class="mp-page"><RoutedPage /></div>
        </SettingsLayout>
        <div v-else>
          <div class="mp-page"><RoutedPage /></div>
        </div>
      </div>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { Region, RoutedPage, useDrawer, useNavigation } from '@magpiejs/console-kit/theme'
import NavIcon from './nav-icon.vue'
import { SettingsLayout } from './parts'

const { model, active, inSettings, href, navigate } = useNavigation()
const drawer = useDrawer()

function go(event: MouseEvent, path: string) {
  if (navigate(event, path)) drawer.closeDrawer()
}
</script>
