<template>
  <MediaCardGrid
    class="mu"
    title="Music"
    :items="data.artists"
    :item-key="(a) => a.id"
    :item-title="(a) => a.title"
    :item-href="(a) => `/music/${a.id}`"
    :item-image="(a) => a.posterUrl"
    :summary="summary"
    card-test-id="artist-card"
  >
    <template #actions>
      <button class="primary" data-testid="add-artist" @click="router.push('/music/add')">
        Add artist
      </button>
    </template>
    <template #notices>
      <LocationNotice v-if="!data.rootFolders.length">to start adding artists.</LocationNotice>
    </template>
    <template #empty>No artists yet. Use <strong>Add artist</strong> to find one.</template>
    <template #meta="{ item: a }">
      <span class="mp-muted mp-count">{{ a.stats.complete }} / {{ a.stats.wanted }}</span>
      <span class="mp-badge" :class="artistStatus(a).class">{{ artistStatus(a).text }}</span>
    </template>
  </MediaCardGrid>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import LocationNotice from '@magpiejs/console-kit/LocationNotice.vue'
import MediaCardGrid from '@magpiejs/console-kit/MediaCardGrid.vue'
import type { MusicData } from '../src/console'
import { artistStatus } from './status'

const data = useRpc<MusicData>()
const router = useRouter()

const summary = computed(() => {
  const all = data.value.artists
  const complete = all.reduce((n, a) => n + a.stats.complete, 0)
  const missing = all.reduce((n, a) => n + a.stats.wanted - a.stats.complete, 0)
  return `${all.length} artists · ${complete} albums complete · ${missing} missing`
})
</script>
