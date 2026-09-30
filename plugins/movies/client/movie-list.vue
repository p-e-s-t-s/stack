<template>
  <MediaCardGrid
    class="mv"
    title="Movies"
    :items="data.movies"
    :item-key="(m) => m.id"
    :item-title="(m) => m.title"
    :item-href="(m) => `/movie/${m.id}`"
    :item-image="(m) => m.posterUrl"
    :summary="summary"
    card-test-id="movie-card"
  >
    <template #before-actions>
      <button @click="router.push('/import?kind=movie')">Import existing library</button>
    </template>
    <template #actions>
      <button class="primary" data-testid="add-movie" @click="router.push('/movies/add')">
        Add movie
      </button>
    </template>
    <template #empty>No movies yet. Use <strong>Add movie</strong> to find one.</template>
    <template #meta="{ item: m }">
      <span class="mp-muted">{{ m.year }}</span>
      <span class="mp-badge" :class="movieStatus(m).class">{{ movieStatus(m).text }}</span>
    </template>
  </MediaCardGrid>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import MediaCardGrid from '@magpiejs/console-kit/MediaCardGrid.vue'
import type { MoviesData } from '../src/console'
import { movieStatus } from './status'

const data = useRpc<MoviesData>()
const router = useRouter()

const summary = computed(() => {
  const all = data.value.movies
  const have = all.filter((m) => m.file).length
  const missing = all.filter((m) => movieStatus(m).text === 'Missing').length
  const downloading = all.filter((m) => m.download).length
  return `${all.length} movies · ${have} downloaded · ${downloading} active downloads · ${missing} missing`
})
</script>
