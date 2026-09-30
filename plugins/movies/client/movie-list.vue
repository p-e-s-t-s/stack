<template>
  <section class="mv">
    <div class="mp-head">
      <h1>Movies</h1>
      <button @click="router.push('/import?kind=movie')">Import existing library</button>
      <input v-if="data.movies.length" v-model="filter" placeholder="Filter" class="mp-filter" />
      <button class="primary" data-testid="add-movie" @click="router.push('/movies/add')">
        Add movie
      </button>
    </div>
    <p v-if="data.movies.length" class="mp-lead">{{ summary }}</p>

    <p v-if="!data.movies.length" class="mp-empty">
      No movies yet. Use <strong>Add movie</strong> to find one.
    </p>
    <div class="mp-grid">
      <a
        v-for="m in shown"
        :key="m.id"
        class="tile"
        :href="`/movie/${m.id}`"
        data-testid="movie-card"
        @click.prevent="router.push(`/movie/${m.id}`)"
      >
        <img v-if="m.posterUrl" class="poster" :src="m.posterUrl" loading="lazy" alt="" />
        <div v-else class="poster placeholder">{{ m.title }}</div>
        <div class="title">{{ m.title }}</div>
        <div class="meta">
          <span class="mp-muted">{{ m.year }}</span>
          <span class="mp-badge" :class="movieStatus(m).class">{{ movieStatus(m).text }}</span>
        </div>
      </a>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { MoviesData } from '../src/console'
import DownloadProgress from '@magpiejs/console-kit/DownloadProgress.vue'
import { movieStatus } from './status'

const data = useRpc<MoviesData>()
const router = useRouter()
const filter = ref('')
const shown = computed(() =>
  data.value.movies.filter((m) => m.title.toLowerCase().includes(filter.value.toLowerCase())),
)

const summary = computed(() => {
  const all = data.value.movies
  const have = all.filter((m) => m.file).length
  const missing = all.filter((m) => movieStatus(m).text === 'Missing').length
  const downloading = all.filter((m) => m.download).length
  return `${all.length} movies · ${have} downloaded · ${downloading} active downloads · ${missing} missing`
})
</script>
