<template>
  <div class="mp-shell">
    <nav class="mp-nav">
      <div class="mp-brand">Magpie</div>
      <template v-for="group in groups" :key="group.name">
        <div v-if="group.name" class="mp-nav-group">{{ group.name }}</div>
        <a
          v-for="page in group.pages"
          :key="page.id"
          :href="href(page)"
          :class="{ active: page === active }"
          @click.prevent="router.push(href(page))"
        >
          {{ page.name }}
        </a>
      </template>
      <form class="mp-nav-foot" method="post" action="/auth/logout">
        <button type="submit" class="mp-logout">Log out</button>
      </form>
    </nav>
    <main class="mp-main">
      <div v-if="ready && !connected" class="mp-offline">
        Lost the connection to Magpie. Reconnecting…
      </div>
      <div class="mp-content">
        <component :is="matched.component" v-if="matched" :key="matched.path" />
        <p v-else-if="ready" class="mp-empty">Page not found.</p>
        <p v-else class="mp-empty">Loading…</p>
      </div>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed, watchEffect } from 'vue'
import { type Activity, useContext, useRoute, useRouter } from '@cordisjs/client'

const ctx = useContext()
const route = useRoute()
const router = useRouter()

// pages group by path: /settings/… under Settings, /system… under System
const GROUPS = [
  { name: '', test: (path: string) => !/^\/(settings|system)(\/|$)/.test(path) },
  { name: 'Settings', test: (path: string) => path.startsWith('/settings/') },
  { name: 'System', test: (path: string) => /^\/system(\/|$)/.test(path) },
]

const groups = computed(() => {
  const pages = Object.values(ctx.client.router.pages)
    .filter((page) => !page.disabled())
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
  return GROUPS.map((g) => ({ name: g.name, pages: pages.filter((p) => g.test(p.path)) })).filter(
    (g) => g.pages.length,
  )
})
const matched = computed(() => route.matched[0])
const ready = computed(() => ctx.client.loader.ready.value)
const connected = computed(() => !!ctx.client.socket.value)

// there is no home page; Movies is where everything starts
watchEffect(() => {
  if (route.path === '/' && ctx.client.router.pages['movies']) void router.replace('/movies')
})

// the sidebar page the current route belongs to: the longest matching path, where detail
// pages count as their list page (/movie/1 and /movies/add highlight Movies)
function matches(page: Activity) {
  const base = href(page)
  if (route.path === base || route.path.startsWith(base + '/')) return true
  return base.endsWith('s') && route.path.startsWith(base.slice(0, -1) + '/')
}
const active = computed(
  () =>
    groups.value
      .flatMap((g) => g.pages)
      .filter(matches)
      .sort((a, b) => href(b).length - href(a).length)[0],
)

function href(page: Activity) {
  return page.path.replace(/:.+/, '')
}
</script>

<style>
.mp-logout {
  font: inherit;
  font-size: 13px;
  color: var(--mp-muted);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.mp-logout:hover {
  color: var(--mp-text);
}
</style>
