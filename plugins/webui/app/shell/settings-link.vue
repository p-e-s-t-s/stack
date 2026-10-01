<template>
  <a
    v-if="model.destination"
    :href="href(model.destination)"
    :class="{ active: inSettings }"
    :aria-current="inSettings ? 'true' : undefined"
    @click="navigate($event, href(model.destination))"
    ><NavIcon name="settings" /><span>Settings</span></a
  >
</template>

<script lang="ts" setup>
import { useNavigation } from '@magpiejs/console-kit/theme'
import NavIcon from './nav-icon.vue'

const { model, inSettings, href, navigate } = useNavigation()
</script>
