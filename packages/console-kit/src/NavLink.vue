<template>
  <a :href="to" @click="go"><slot /></a>
</template>

<script lang="ts" setup>
// A link that changes the console's route without reloading the page. The console has no
// `<router-link>`; this is the same `<a href @click.prevent="router.push(…)">` every page
// used to write by hand. Modified clicks (new tab, new window) keep their normal behaviour.
import { useRouter } from '@cordisjs/client'

const props = defineProps<{ to: string }>()
const router = useRouter()

function go(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  router.push(props.to)
}
</script>
