<template>
  <section class="mu">
    <div class="mp-head">
      <h1>Music</h1>
      <input v-if="data.artists.length" v-model="filter" placeholder="Filter" class="filter" />
      <button class="primary" data-testid="add-artist" @click="router.push('/music/add')">
        Add artist
      </button>
    </div>
    <p v-if="data.artists.length" class="mp-lead">{{ summary }}</p>
    <div v-if="!data.rootFolders.length" class="mp-card">
      Add a <strong>Music</strong> root folder in
      <a href="/settings/media" @click.prevent="router.push('/settings/media')">Media management</a>
      to start adding artists.
    </div>
    <p v-if="!data.artists.length" class="mp-empty">
      No artists yet. Use <strong>Add artist</strong> to find one.
    </p>
    <div class="grid">
      <a
        v-for="a in shown"
        :key="a.id"
        class="card"
        :href="`/music/${a.id}`"
        data-testid="artist-card"
        @click.prevent="router.push(`/music/${a.id}`)"
      >
        <img
          v-if="a.posterUrl && !broken.has(a.id)"
          class="poster"
          :src="a.posterUrl"
          loading="lazy"
          alt=""
          @error="broken.add(a.id)"
        />
        <div v-else class="poster placeholder">{{ a.title }}</div>
        <div class="title">{{ a.title }}</div>
        <div class="meta">
          <span class="mp-muted count">{{ a.stats.complete }} / {{ a.stats.wanted }}</span>
          <span class="mp-badge" :class="artistStatus(a).class">{{ artistStatus(a).text }}</span>
        </div>
      </a>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, reactive, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { MusicData } from '../src/console'
import { artistStatus } from './status'

const data = useRpc<MusicData>()
const router = useRouter()
const filter = ref('')
const broken = reactive(new Set<number>())
const shown = computed(() =>
  data.value.artists.filter((a) => a.title.toLowerCase().includes(filter.value.toLowerCase())),
)
const summary = computed(() => {
  const all = data.value.artists
  const complete = all.reduce((n, a) => n + a.stats.complete, 0)
  const missing = all.reduce((n, a) => n + a.stats.wanted - a.stats.complete, 0)
  return `${all.length} artists · ${complete} albums complete · ${missing} missing`
})
</script>
