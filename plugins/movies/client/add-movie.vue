<template>
  <section class="mv">
    <div class="mp-head">
      <h1>Add movie</h1>
    </div>
    <p v-if="!data.setup.metadata" class="mp-lead">
      Movie search needs TMDB:
      <a href="/settings/metadata" @click.prevent="router.push('/settings/metadata')"
        >add your API key</a
      >.
    </p>
    <form class="mp-row search" @submit.prevent="search">
      <input
        v-model="term"
        placeholder="Search for a movie by title"
        data-testid="lookup"
        autofocus
      />
      <button class="primary" type="submit" :disabled="!term.trim() || searching">
        {{ searching ? 'Searching…' : 'Search' }}
      </button>
    </form>
    <p v-if="error" class="mp-error">{{ error }}</p>

    <template v-if="results.length">
      <div v-if="!data.rootFolders.length" class="mp-card">
        Add a movie root folder in
        <a href="/settings/media" @click.prevent="router.push('/settings/media')"
          >Media management</a
        >
        first.
      </div>
      <div v-else class="mp-card options">
        <label>
          <span>Quality</span>
          <select v-model="form.profileId">
            <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label v-if="data.rootFolders.length > 1">
          <span>Folder</span>
          <select v-model="form.rootFolderId">
            <option v-for="f in data.rootFolders" :key="f.id" :value="f.id">{{ f.path }}</option>
          </select>
        </label>
        <label>
          <span>Download when</span>
          <select v-model="form.minimumAvailability">
            <option value="announced">Announced</option>
            <option value="inCinemas">In cinemas</option>
            <option value="released">Released</option>
          </select>
        </label>
        <label class="check">
          <input v-model="form.search" type="checkbox" />
          <span>Start searching right away</span>
        </label>
      </div>

      <div v-for="r in results" :key="r.ids.tmdb" class="result" data-testid="lookup-result">
        <img v-if="r.posterUrl" class="poster" :src="r.posterUrl" alt="" />
        <div v-else class="poster placeholder" />
        <div class="body">
          <div class="title">
            <strong>{{ r.title }}</strong> <span class="mp-muted">{{ r.year }}</span>
          </div>
          <p class="mp-muted overview">{{ r.overview }}</p>
        </div>
        <div class="action">
          <button v-if="r.libraryId" @click="router.push(`/movie/${r.libraryId}`)">
            In library
          </button>
          <button
            v-else
            class="primary"
            :disabled="!form.rootFolderId || adding"
            data-testid="add"
            @click="add(r)"
          >
            Add
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { MoviesData } from '../src/console'

const data = useRpc<MoviesData>()
const router = useRouter()
const term = ref('')
const error = ref('')
const searching = ref(false)
const adding = ref(false)
const results = ref<Awaited<ReturnType<MoviesData['lookup']>>>([])
const form = reactive({
  profileId: data.value.profiles.find((p) => p.name === 'HD')?.id ?? data.value.profiles[0]?.id,
  rootFolderId: data.value.rootFolders[0]?.id,
  minimumAvailability: 'released' as const,
  search: true,
})

// pick defaults once profiles and folders arrive or change
watch(
  () => [data.value.profiles, data.value.rootFolders] as const,
  ([profiles, folders]) => {
    if (!profiles.some((p) => p.id === form.profileId)) form.profileId = profiles[0]?.id
    if (!folders.some((f) => f.id === form.rootFolderId)) form.rootFolderId = folders[0]?.id
  },
  { deep: true },
)

async function search() {
  error.value = ''
  searching.value = true
  try {
    results.value = await data.value.lookup(term.value)
    if (!results.value.length) error.value = 'Nothing found.'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    searching.value = false
  }
}

async function add(r: (typeof results.value)[number]) {
  error.value = ''
  adding.value = true
  try {
    const id = await data.value.add({
      ...form,
      tmdbId: Number(r.ids.tmdb),
      profileId: form.profileId!,
      rootFolderId: form.rootFolderId!,
    })
    router.push(`/movie/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    adding.value = false
  }
}
</script>
