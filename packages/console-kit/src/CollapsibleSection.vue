<template>
  <details class="mp-section" :open="open">
    <summary>
      <slot name="summary">
        <h3>{{ title }}</h3>
        <span v-if="count !== undefined" class="mp-muted mp-small mp-count">{{ count }}</span>
      </slot>
    </summary>
    <slot />
  </details>
</template>

<script lang="ts" setup>
// A collapsible group of rows (a series' seasons, an artist's albums by type). The summary
// is a title and a count unless the page supplies its own, with checkboxes or buttons in it.
defineProps<{ title?: string; count?: string | number; open?: boolean }>()
</script>
