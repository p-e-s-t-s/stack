<template>
  <div class="mp-shell">
    <nav class="mp-nav">
      <div class="mp-brand">Magpie</div>
      <a
        v-for="page in pages"
        :key="page.id"
        :href="href(page)"
        :class="{ active: route.meta.activity === page }"
        @click.prevent="router.push(href(page))"
      >
        {{ page.name }}
      </a>
      <div class="mp-conn" :class="{ online: connected }">
        {{ connected ? 'connected' : 'offline' }}
      </div>
    </nav>
    <main class="mp-main">
      <component v-if="matched" :is="matched.component" :key="matched.path" />
      <p v-else-if="ready" class="mp-empty">Page not found.</p>
      <p v-else class="mp-empty">Loading…</p>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { type Activity, useContext, useRoute, useRouter } from '@cordisjs/client'

const ctx = useContext()
const route = useRoute()
const router = useRouter()

const pages = computed(() =>
  Object.values(ctx.client.router.pages)
    .filter((page) => !page.disabled())
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0)),
)
const matched = computed(() => route.matched[0])
const ready = computed(() => ctx.client.loader.ready.value)
const connected = computed(() => !!ctx.client.socket.value)

function href(page: Activity) {
  return page.path.replace(/:.+/, '')
}
</script>
