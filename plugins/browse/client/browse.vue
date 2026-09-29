<template>
  <section class="browse">
    <div class="mp-head">
      <h1>Browse</h1>
      <label>Country <input v-model="region" maxlength="2" aria-label="Country code" /></label>
    </div>
    <p v-if="!data.enabled" class="mp-muted">Enable a media plugin to browse titles.</p>
    <p v-else-if="!data.feeds.length" class="mp-lead">
      Enable a discovery provider in
      <a href="/settings/metadata" @click.prevent="router.push('/settings/metadata')"
        >Metadata settings</a
      >
      to find new and trending titles.
    </p>
    <template v-else>
      <nav class="mp-row" aria-label="Media type">
        <button :aria-pressed="filter === ''" @click="filter = ''">All</button>
        <button
          v-for="kind in kinds"
          :key="kind"
          :aria-pressed="filter === kind"
          @click="filter = kind"
        >
          {{ kind === 'movie' ? 'Movies' : kind === 'series' ? 'TV' : kind }}
        </button>
      </nav>
      <section v-for="feed in visible" :key="key(feed)" class="shelf">
        <h2>{{ feed.label }}</h2>
        <p class="mp-muted">
          {{ feed.description }} <span>· {{ feed.providerId.toUpperCase() }}</span>
        </p>
        <p v-if="states[key(feed)]?.error" class="mp-error">
          {{ states[key(feed)].error }} <button @click="load(feed)">Retry</button>
        </p>
        <p v-else-if="!states[key(feed)]?.items" class="mp-muted" role="status">Loading…</p>
        <p v-else-if="!states[key(feed)].items?.length" class="mp-muted">No titles found.</p>
        <div v-else class="cards">
          <a
            v-for="(item, index) in states[key(feed)].items"
            :key="JSON.stringify(item.ids)"
            :href="item.link"
            class="browse-card"
            @click.prevent="item.link && router.push(item.link)"
          >
            <img v-if="item.posterUrl" :src="item.posterUrl" :alt="item.title" loading="lazy" />
            <div v-else class="poster-placeholder">{{ item.title }}</div>
            <strong
              >{{ feed.id.includes('trending') ? `${index + 1}. ` : '' }}{{ item.title }}</strong
            >
            <span class="mp-muted">{{ item.year }}{{ item.inLibrary ? ' · In library' : '' }}</span>
          </a>
        </div>
      </section>
      <p v-if="data.feeds.some((feed) => feed.providerId === 'tmdb')" class="mp-muted">
        Data and images by
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">TMDB</a>.
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { BrowseData, BrowseFeed, BrowseItem } from '../src'
const data = useRpc<BrowseData>()
const router = useRouter()
const region = ref('US')
const filter = ref('')
const kinds = computed(() => [...new Set(data.value.feeds.map((f) => f.kind))])
const visible = computed(() =>
  data.value.feeds.filter((f) => !filter.value || f.kind === filter.value),
)
const states = ref<Record<string, { items?: BrowseItem[]; error?: string }>>({})
const key = (f: BrowseFeed) => JSON.stringify([f.providerId, f.id])
let generation = 0
async function load(feed: BrowseFeed, version = generation) {
  const id = key(feed)
  states.value[id] = {}
  try {
    const items = await data.value.load(feed.providerId, feed.id, region.value.toUpperCase())
    if (version === generation) states.value[id] = { items }
  } catch (e) {
    if (version === generation) states.value[id] = { error: (e as Error).message }
  }
}
watch(
  () => [data.value.revision, region.value],
  () => {
    const version = ++generation
    states.value = {}
    if (!kinds.value.some((kind) => kind === filter.value)) filter.value = ''
    if (/^[a-z]{2}$/i.test(region.value))
      for (const feed of data.value.feeds) void load(feed, version)
  },
  { immediate: true },
)
</script>

<style scoped>
.browse {
  max-width: 1500px;
  margin: auto;
}
.browse .mp-head label {
  display: flex;
  align-items: center;
  gap: 10px;
}
.browse input {
  width: 65px;
  text-transform: uppercase;
}
.shelf {
  margin: 32px 0;
}
.shelf h2 {
  margin-bottom: 6px;
}
.cards {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 155px;
  overflow-x: auto;
  gap: 18px;
  padding-bottom: 16px;
}
.browse-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: inherit;
  text-decoration: none;
}
.browse-card img,
.poster-placeholder {
  width: 155px;
  height: 232px;
  object-fit: cover;
  border-radius: 10px;
  background: var(--mp-panel, #202630);
}
.poster-placeholder {
  display: grid;
  place-items: center;
  padding: 15px;
  box-sizing: border-box;
}
.browse-card:hover strong {
  text-decoration: underline;
}
</style>
