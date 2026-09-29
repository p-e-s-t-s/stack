<template>
  <div
    class="mp-progress"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="downloadPercent(progress)"
  >
    <div :style="{ width: `${downloadPercent(progress)}%` }" />
  </div>
</template>

<script setup lang="ts">
import { downloadPercent } from './status'
defineProps<{ progress: number; label: string }>()
</script>
