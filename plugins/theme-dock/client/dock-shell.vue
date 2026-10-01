<template>
  <div class="dock">
    <a class="mp-skip" href="#mp-main">Skip to content</a>
    <header class="dock-bar">
      <span class="mp-brand">Magpie<span class="mp-brand-dot">.</span></span>
      <nav class="dock-links" aria-label="Main navigation">
        <a
          v-for="page in primary"
          :key="page.id"
          :href="href(page)"
          :class="{ active: page === active }"
          :aria-current="page === active ? 'page' : undefined"
          @click="navigate($event, href(page))"
          >{{ page.name }}</a
        >
      </nav>
      <Region name="shell.nav-foot" class="dock-foot" />
    </header>
    <main id="mp-main" class="mp-main dock-main" tabindex="-1">
      <Region name="shell.notices" tag="" />
      <Region name="shell.topbar" />
      <div class="mp-content" :class="{ 'mp-content-settings': inSettings }">
        <Part v-if="inSettings" name="settings.layout">
          <div class="mp-page"><RoutedPage /></div>
        </Part>
        <div v-else class="mp-page"><RoutedPage /></div>
      </div>
    </main>
  </div>
</template>

<script lang="ts" setup>
// A different frame over the same navigation model and regions as the built-in shell.
import { computed } from 'vue'
import { Part, Region, RoutedPage, useNavigation } from '@magpiejs/console-kit/theme'

const { model, active, inSettings, href, navigate } = useNavigation()
const primary = computed(() => model.value.groups.flatMap((group) => group.pages))
</script>
