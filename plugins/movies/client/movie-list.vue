<template>
  <section class="mv">
    <div class="mp-head">
      <h1>Movies</h1>
      <input v-if="data.movies.length" v-model="filter" placeholder="Filter" class="filter" />
      <button class="primary" data-testid="add-movie" @click="router.push('/movies/add')">
        Add movie
      </button>
    </div>
    <p v-if="data.movies.length" class="mp-lead">{{ summary }}</p>

    <div v-if="steps.some((s) => !s.done)" class="mp-card setup" data-testid="setup">
      <h3>Finish setting up Magpie</h3>
      <ol>
        <li v-for="s in steps" :key="s.path" :class="{ done: s.done }">
          <span class="check">{{ s.done ? '✓' : '' }}</span>
          <a v-if="!s.done" :href="s.path" @click.prevent="router.push(s.path)">{{ s.text }}</a>
          <span v-else>{{ s.text }}</span>
          <span class="mp-muted mp-small"> — {{ s.why }}</span>
        </li>
      </ol>
    </div>

    <p v-if="!data.movies.length" class="mp-empty">
      No movies yet. Use <strong>Add movie</strong> to find one.
    </p>
    <div class="grid">
      <a
        v-for="m in shown"
        :key="m.id"
        class="card"
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
  return `${all.length} movies · ${have} downloaded · ${missing} missing`
})

const steps = computed(() => {
  const s = data.value.setup
  return [
    {
      done: s.metadata,
      path: '/settings/metadata',
      text: 'Add your TMDB API key',
      why: 'to look up movies',
    },
    {
      done: s.rootFolder,
      path: '/settings/media',
      text: 'Choose where your movies live',
      why: 'a root folder for the library',
    },
    {
      done: s.indexer,
      path: '/settings/indexers',
      text: 'Add an indexer',
      why: 'to search for releases (e.g. from Prowlarr)',
    },
    {
      done: s.client,
      path: '/settings/clients',
      text: 'Add a download client',
      why: 'qBittorrent downloads what Magpie picks',
    },
  ]
})
</script>
