<template>
  <section class="pc">
    <div class="mp-head">
      <h1>Podcasts</h1>
      <input v-if="data.podcasts.length" v-model="filter" placeholder="Filter" class="filter" />
      <button :disabled="!data.podcasts.length" @click="exportOpml">Export OPML</button>
      <button class="primary" data-testid="add-podcast" @click="router.push('/podcasts/add')">
        Add podcast
      </button>
    </div>
    <p v-if="data.podcasts.length" class="mp-lead">{{ summary }}</p>
    <div v-if="!data.rootFolders.length" class="mp-card">
      Add a <strong>Podcasts</strong> root folder in
      <a href="/settings/media" @click.prevent="router.push('/settings/media')">Media management</a>
      to start following podcasts.
    </div>
    <div v-else-if="!data.canDownload" class="mp-card">
      Add a <strong>direct download</strong> client in
      <a href="/settings/clients" @click.prevent="router.push('/settings/clients')"
        >Download clients</a
      >
      so episodes can be downloaded.
    </div>

    <p v-if="!data.podcasts.length" class="mp-empty">
      No podcasts yet. Use <strong>Add podcast</strong> to search for one, paste a feed URL or
      import an OPML file.
    </p>
    <div class="mp-grid">
      <a
        v-for="p in shown"
        :key="p.id"
        class="tile"
        :href="`/podcasts/${p.id}`"
        data-testid="podcast-card"
        @click.prevent="router.push(`/podcasts/${p.id}`)"
      >
        <img v-if="p.posterUrl" class="poster" :src="p.posterUrl" loading="lazy" alt="" />
        <div v-else class="poster placeholder">{{ p.title }}</div>
        <div class="title">{{ p.title }}</div>
        <div class="meta">
          <span class="mp-muted mp-count">{{ p.stats.downloaded }} / {{ p.stats.episodes }}</span>
          <span class="mp-badge" :class="podcastStatus(p).class">{{ podcastStatus(p).text }}</span>
        </div>
      </a>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { PodcastsData } from '../src/console'
import { podcastStatus } from './status'

const data = useRpc<PodcastsData>()
const router = useRouter()
const filter = ref('')
const shown = computed(() =>
  data.value.podcasts.filter((p) => p.title.toLowerCase().includes(filter.value.toLowerCase())),
)
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
