<template>
  <div class="mp-card" data-testid="location-notice">
    Choose a library location in
    <NavLink to="/settings/media">Media management</NavLink>{{ ' ' }}<slot>first.</slot>
  </div>
</template>

<script lang="ts" setup>
import NavLink from './NavLink.vue'
</script>
