<template>
  <section class="sr">
    <div class="mp-head">
      <h1>Series</h1>
      <input v-if="data.series.length" v-model="filter" placeholder="Filter" class="filter" />
      <button class="primary" data-testid="add-series" @click="router.push('/series/add')">
        Add series
      </button>
    </div>
    <p v-if="data.series.length" class="mp-lead">{{ summary }}</p>
    <div v-if="!data.rootFolders.length" class="mp-card">
      Add a <strong>Series</strong> root folder in
      <a href="/settings/media" @click.prevent="router.push('/settings/media')">Media management</a>
      to start adding shows.
    </div>

    <p v-if="!data.series.length" class="mp-empty">
      No series yet. Use <strong>Add series</strong> to find one.
    </p>
    <div class="mp-grid">
      <a
        v-for="s in shown"
        :key="s.id"
        class="tile"
        :href="`/series/${s.id}`"
        data-testid="series-card"
        @click.prevent="router.push(`/series/${s.id}`)"
      >
        <img v-if="s.posterUrl" class="poster" :src="s.posterUrl" loading="lazy" alt="" />
        <div v-else class="poster placeholder">{{ s.title }}</div>
        <div class="title">{{ s.title }}</div>
        <div class="meta">
          <span class="mp-muted mp-count">{{ s.stats.downloaded }} / {{ s.stats.wanted }}</span>
          <span class="mp-badge" :class="seriesStatus(s).class">{{ seriesStatus(s).text }}</span>
        </div>
      </a>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { SeriesData } from '../src/console'
import { seriesStatus } from './status'

const data = useRpc<SeriesData>()
const router = useRouter()
const filter = ref('')
const shown = computed(() =>
  data.value.series.filter((s) => s.title.toLowerCase().includes(filter.value.toLowerCase())),
)
const summary = computed(() => {
  const all = data.value.series
  const episodes = all.reduce((n, s) => n + s.stats.files, 0)
  const missing = all.reduce((n, s) => n + s.stats.wanted - s.stats.downloaded, 0)
  return `${all.length} series · ${episodes} episodes downloaded · ${missing} missing`
})
</script>
