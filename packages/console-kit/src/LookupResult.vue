<template>
  <div class="mp-result" data-testid="lookup-result">
    <template v-if="!noImage">
      <img v-if="image && !broken" class="poster" :src="image" alt="" @error="broken = true" />
      <div v-else class="poster placeholder" />
    </template>
    <div class="body">
      <div class="title">
        <strong>{{ title }}</strong> <span v-if="subtitle" class="mp-muted">{{ subtitle }}</span>
      </div>
      <p v-if="overview" class="mp-muted overview">{{ overview }}</p>
    </div>
    <div class="action"><slot /></div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
// One search result: poster, title, a line after the title (year, author), an overview,
// and the page's own button (Add, Follow, In library).
const props = defineProps<{
  title: string
  subtitle?: string | number | null
  overview?: string | null
  image?: string | null
  /** Kinds whose results have no artwork (artists) leave the poster column out. */
  noImage?: boolean
}>()

// a cover that fails to load shows the placeholder instead
const broken = ref(false)
watch(
  () => props.image,
  () => (broken.value = false),
)
</script>
