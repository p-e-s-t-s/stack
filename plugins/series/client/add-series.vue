<template>
  <AddMediaFlow
    class="sr"
    title="Add series"
    placeholder="Search for a show by title"
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
    <template #options>
      <ProfileFolderFields
        v-model:profile-id="form.profileId"
        v-model:root-folder-id="form.rootFolderId"
        :profiles="data.profiles"
        :root-folders="data.rootFolders"
      />
      <label>
        <span>Monitor</span>
        <select v-model="form.monitor" data-testid="monitor">
          <option value="all">All episodes</option>
          <option value="future">Future episodes</option>
          <option value="missing">Missing episodes</option>
          <option value="first">First season</option>
          <option value="latest">Latest season</option>
          <option value="none">None</option>
        </select>
      </label>
      <label>
        <span>Type</span>
        <select v-model="form.seriesType">
          <option value="standard">Standard</option>
          <option value="daily">Daily (talk shows, news)</option>
          <option value="anime">Anime</option>
        </select>
      </label>
      <label class="check">
        <input v-model="form.seasonFolders" type="checkbox" />
        <span>Season folders</span>
      </label>
      <label class="check">
        <input v-model="form.search" type="checkbox" />
        <span>Start searching right away</span>
      </label>
    </template>
    <template #action="{ result: r }">
      <button v-if="r.libraryId" @click="router.push(`/series/${r.libraryId}`)">In library</button>
      <button
        v-else
        class="primary"
        :disabled="!form.rootFolderId || adding"
        data-testid="add"
        @click="add(r)"
      >
        {{ adding ? 'Adding…' : 'Add' }}
      </button>
    </template>
  </AddMediaFlow>
</template>

<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import AddMediaFlow from '@magpiejs/console-kit/AddMediaFlow.vue'
import ProfileFolderFields from '@magpiejs/console-kit/ProfileFolderFields.vue'
import type { SeriesData } from '../src/console'
import type { MonitorOption, SeriesType } from '../src/schema'

const data = useRpc<SeriesData>()
const router = useRouter()
const route = useRoute()
const term = ref(typeof route.query.q === 'string' ? route.query.q : '')
const error = ref('')
const searching = ref(false)
const adding = ref(false)
const results = ref<Awaited<ReturnType<SeriesData['lookup']>>>([])
const form = reactive({
  profileId: data.value.profiles.find((p) => p.name === 'HD')?.id ?? data.value.profiles[0]?.id,
  rootFolderId: data.value.rootFolders[0]?.id,
  monitor: 'all' as MonitorOption,
  seriesType: 'standard' as SeriesType,
  seasonFolders: true,
  search: true,
})

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
    router.push(`/series/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    adding.value = false
  }
}
</script>
