<template>
  <Shell />
</template>

<script lang="ts" setup>
// The engine's root (docs/themes.md §3.2): not themeable, no design of its own. It sends
// `/` to the landing page and renders the `shell` part, which a theme may replace.
import { useRouter, useRoute } from '@cordisjs/client'
import { watchEffect } from 'vue'
import { useNavigation } from '@magpiejs/console-kit/theme'
import { Shell } from './parts'

const route = useRoute()
const router = useRouter()
const { model, href } = useNavigation()

watchEffect(() => {
  if (route.path === '/' && model.value.landing && href(model.value.landing) !== '/') {
    void router.replace(href(model.value.landing))
  }
})
</script>
