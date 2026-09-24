<template>
  <section class="mv">
    <div class="row" style="justify-content: space-between">
      <h1 style="margin: 0">Movies</h1>
      <div class="row">
        <input v-model="filter" placeholder="Filter" />
        <button class="primary" data-testid="add-movie" @click="router.push('/movies/add')">
          Add movie
        </button>
      </div>
    </div>
    <p v-if="!data.movies.length" class="muted">No movies yet. Add one to get started.</p>
    <div class="grid">
      <div
        v-for="m in shown"
        :key="m.id"
        class="card"
        data-testid="movie-card"
        @click="router.push(`/movie/${m.id}`)"
      >
        <img v-if="m.posterUrl" class="poster" :src="m.posterUrl" loading="lazy" />
        <div v-else class="poster" />
        <div class="title">{{ m.title }}</div>
        <div class="muted">{{ m.year }}</div>
        <span class="badge" :class="status(m).class">{{ status(m).text }}</span>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { MovieSummary, MoviesData } from '../src/console'

const data = useRpc<MoviesData>()
const router = useRouter()
const filter = ref('')
const shown = computed(() =>
  data.value.movies.filter((m) => m.title.toLowerCase().includes(filter.value.toLowerCase())),
)

function status(m: MovieSummary) {
  if (m.download)
    return { text: `Downloading ${Math.floor(m.download.progress * 100)}%`, class: 'waiting' }
  if (m.file) return { text: 'Downloaded', class: 'have' }
  if (!m.monitored) return { text: 'Not monitored', class: 'waiting' }
  if (!m.available) return { text: 'Not available yet', class: 'waiting' }
  return { text: 'Missing', class: 'missing' }
}
</script>
