<template>
  <AddMediaFlow
    class="mv"
    title="Add movie"
    placeholder="Search for a movie by title"
    v-model:term="term"
    :searching="searching"
    :error="error"
    :results="results"
    :has-location="!!data.rootFolders.length"
    :result-key="(r) => r.ids.tmdb!"
    :result-title="(r) => r.title"
    :result-subtitle="(r) => r.year"
    :result-overview="(r) => r.overview"
    :result-image="(r) => r.posterUrl"
    @search="search"
  >
    <template #notice>
      <p v-if="!data.setup.metadata" class="mp-lead">
        Movie search needs TMDB:
        <NavLink to="/settings/metadata">add your API key</NavLink>.
      </p>
    </template>
    <template #options>
      <ProfileFolderFields
        v-model:profile-id="form.profileId"
        v-model:root-folder-id="form.rootFolderId"
        :profiles="data.profiles"
        :root-folders="data.rootFolders"
      />
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
    </template>
    <template #action="{ result: r }">
      <button v-if="r.libraryId" @click="router.push(`/movie/${r.libraryId}`)">In library</button>
      <button
        v-else
        class="primary"
        :disabled="!form.rootFolderId || adding"
        data-testid="add"
        @click="add(r)"
      >
        Add
      </button>
    </template>
  </AddMediaFlow>
</template>

<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import AddMediaFlow from '@magpiejs/console-kit/AddMediaFlow.vue'
import NavLink from '@magpiejs/console-kit/NavLink.vue'
import ProfileFolderFields from '@magpiejs/console-kit/ProfileFolderFields.vue'
import type { MoviesData } from '../src/console'

const data = useRpc<MoviesData>()
const router = useRouter()
const route = useRoute()
const term = ref(typeof route.query.q === 'string' ? route.query.q : '')
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

watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q.trim()) {
      term.value = q
      void search()
    }
  },
  { immediate: true },
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
