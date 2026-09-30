<template>
  <MediaCardGrid
    class="sr"
    title="Series"
    :items="data.series"
    :item-key="(s) => s.id"
    :item-title="(s) => s.title"
    :item-href="(s) => `/series/${s.id}`"
    :item-image="(s) => s.posterUrl"
    :summary="summary"
    card-test-id="series-card"
  >
    <template #actions>
      <button class="primary" data-testid="add-series" @click="router.push('/series/add')">
        Add series
      </button>
    </template>
    <template #notices>
      <LocationNotice v-if="!data.rootFolders.length">to start adding shows.</LocationNotice>
    </template>
    <template #empty>No series yet. Use <strong>Add series</strong> to find one.</template>
    <template #meta="{ item: s }">
      <span class="mp-muted mp-count">{{ s.stats.downloaded }} / {{ s.stats.wanted }}</span>
      <span class="mp-badge" :class="seriesStatus(s).class">{{ seriesStatus(s).text }}</span>
    </template>
  </MediaCardGrid>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import LocationNotice from '@magpiejs/console-kit/LocationNotice.vue'
import MediaCardGrid from '@magpiejs/console-kit/MediaCardGrid.vue'
import type { SeriesData } from '../src/console'
import { seriesStatus } from './status'

const data = useRpc<SeriesData>()
const router = useRouter()

const summary = computed(() => {
  const all = data.value.series
  const episodes = all.reduce((n, s) => n + s.stats.files, 0)
  const missing = all.reduce((n, s) => n + s.stats.wanted - s.stats.downloaded, 0)
  return `${all.length} series · ${episodes} episodes downloaded · ${missing} missing`
})
</script>
