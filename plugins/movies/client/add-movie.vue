<template>
  <section class="mv">
    <h1>Add movie</h1>
    <form class="row" @submit.prevent="search">
      <input
        v-model="term"
        placeholder="Movie title"
        style="flex: 1"
        data-testid="lookup"
        autofocus
      />
      <button class="primary" type="submit">Search</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!data.rootFolders.length" class="muted">
      Add a movie root folder in
      <a href="/settings/media" @click.prevent="router.push('/settings/media')">Media management</a>
      first.
    </p>

    <div v-for="r in results" :key="r.ids.tmdb" class="mp-card result" data-testid="lookup-result">
      <img v-if="r.posterUrl" class="poster" :src="r.posterUrl" />
      <div style="flex: 1">
        <strong>{{ r.title }}</strong> <span class="muted">{{ r.year }}</span>
        <p class="muted">{{ r.overview }}</p>
        <div v-if="r.libraryId" class="row">
          <span class="muted">Already in your library.</span>
          <button @click="router.push(`/movie/${r.libraryId}`)">Open</button>
        </div>
        <div v-else class="row">
          <label>Profile</label>
          <select v-model="form.profileId">
            <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label>Folder</label>
          <select v-model="form.rootFolderId">
            <option v-for="f in data.rootFolders" :key="f.id" :value="f.id">{{ f.path }}</option>
          </select>
          <label>Available when</label>
          <select v-model="form.minimumAvailability">
            <option value="announced">Announced</option>
            <option value="inCinemas">In cinemas</option>
            <option value="released">Released</option>
          </select>
          <label><input v-model="form.search" type="checkbox" /> Search now</label>
          <button class="primary" :disabled="!form.rootFolderId" data-testid="add" @click="add(r)">
            Add
          </button>
        </div>
      </div>
    </div>
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
  try {
    results.value = await data.value.lookup(term.value)
    if (!results.value.length) error.value = 'Nothing found.'
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function add(r: (typeof results.value)[number]) {
  error.value = ''
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
  }
}
</script>
