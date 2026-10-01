<template>
  <div class="mp-settings-heading">
    <span class="mp-eyebrow">WORKSPACE</span>
    <h1>Settings</h1>
    <p class="mp-muted">Manage your library, connections, and system.</p>
  </div>
  <div class="mp-settings-layout">
    <nav class="mp-settings-nav" aria-label="Settings navigation">
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
    <slot />
  </div>
</template>

<script lang="ts" setup>
import { useNavigation } from '@magpiejs/console-kit/theme'

const { model, active, href, navigate } = useNavigation()
</script>
