<template>
  <MediaCardGrid
    class="pc"
    title="Podcasts"
    :items="data.podcasts"
    :item-key="(p) => p.id"
    :item-title="(p) => p.title"
    :item-href="(p) => `/podcasts/${p.id}`"
    :item-image="(p) => p.posterUrl"
    :summary="summary"
    card-test-id="podcast-card"
  >
    <template #actions>
      <button :disabled="!data.podcasts.length" @click="exportOpml">Export OPML</button>
      <button class="primary" data-testid="add-podcast" @click="router.push('/podcasts/add')">
        Add podcast
      </button>
    </template>
    <template #notices>
      <LocationNotice v-if="!data.rootFolders.length">to start following podcasts.</LocationNotice>
      <div v-else-if="!data.canDownload" class="mp-card">
        Add a <strong>direct download</strong> client in
        <NavLink to="/settings/clients">Download clients</NavLink>
        so episodes can be downloaded.
      </div>
    </template>
    <template #empty>
      No podcasts yet. Use <strong>Add podcast</strong> to search for one, paste a feed URL or
      import an OPML file.
    </template>
    <template #meta="{ item: p }">
      <span class="mp-muted mp-count">{{ p.stats.downloaded }} / {{ p.stats.episodes }}</span>
      <span class="mp-badge" :class="podcastStatus(p).class">{{ podcastStatus(p).text }}</span>
    </template>
  </MediaCardGrid>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import LocationNotice from '@magpiejs/console-kit/LocationNotice.vue'
import MediaCardGrid from '@magpiejs/console-kit/MediaCardGrid.vue'
import NavLink from '@magpiejs/console-kit/NavLink.vue'
import type { PodcastsData } from '../src/console'
import { podcastStatus } from './status'

const data = useRpc<PodcastsData>()
const router = useRouter()
const summary = computed(() => {
  const all = data.value.podcasts
  const downloaded = all.reduce((n, p) => n + p.stats.downloaded, 0)
  const wanted = all.reduce((n, p) => n + p.stats.wanted, 0)
  return `${all.length} podcasts · ${downloaded} episodes downloaded · ${wanted} to download`
})

async function exportOpml() {
  const xml = await data.value.exportOpml()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([xml], { type: 'text/x-opml' }))
  a.download = 'magpie-podcasts.opml'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>
