<template>
  <AddMediaFlow
    class="mu"
    title="Add artist"
    placeholder="Search for an artist"
    v-model:term="term"
    :searching="searching"
    :error="error"
    :results="results"
    :has-location="!!data.rootFolders.length"
    :result-key="(r) => r.ids.musicbrainz!"
    :result-title="(r) => r.title"
    :result-overview="(r) => r.overview"
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
          <option value="all">All albums</option>
          <option value="latest">The newest album, and future ones</option>
          <option value="future">Future albums only</option>
          <option value="none">None (pick albums yourself)</option>
        </select>
      </label>
      <label class="check">
        <input v-model="form.search" type="checkbox" />
        <span>Start searching right away</span>
      </label>
      <div>
        <div class="mp-small mp-muted">Types</div>
        <div class="types">
          <label v-for="t in data.primaryTypes" :key="t">
            <input v-model="form.albumTypes" type="checkbox" :value="t" /> {{ t }}
          </label>
        </div>
      </div>
      <div>
        <div class="mp-small mp-muted">Also allow (none: studio releases only)</div>
        <div class="types">
          <label v-for="t in ['Live', 'Compilation', 'Soundtrack', 'Remix', 'Demo']" :key="t">
            <input v-model="form.secondaryTypes" type="checkbox" :value="t" /> {{ t }}
          </label>
        </div>
      </div>
    </template>
    <template #action="{ result: r }">
      <button v-if="r.libraryId" @click="router.push(`/music/${r.libraryId}`)">In library</button>
      <button
        v-else
        class="primary"
        :disabled="!form.rootFolderId || !form.albumTypes.length || !!adding"
        data-testid="add"
        @click="add(r)"
      >
        {{ adding === r.ids.musicbrainz ? 'Adding…' : 'Add' }}
      </button>
    </template>
  </AddMediaFlow>
</template>

<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import AddMediaFlow from '@magpiejs/console-kit/AddMediaFlow.vue'
import ProfileFolderFields from '@magpiejs/console-kit/ProfileFolderFields.vue'
import type { MusicData } from '../src/console'
import type { MonitorOption } from '../src/schema'

const data = useRpc<MusicData>()
const router = useRouter()
const term = ref('')
const error = ref('')
const searching = ref(false)
const adding = ref<string>()
const results = ref<Awaited<ReturnType<MusicData['lookup']>>>([])
const form = reactive({
  profileId:
    data.value.profiles.find((p) => p.name === 'Standard')?.id ?? data.value.profiles[0]?.id,
  rootFolderId: data.value.rootFolders[0]?.id,
  monitor: 'all' as MonitorOption,
  albumTypes: ['Album', 'EP'],
  secondaryTypes: [] as string[],
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
  adding.value = r.ids.musicbrainz
  try {
    const id = await data.value.add({
      ...form,
      artistId: r.ids.musicbrainz!,
      profileId: form.profileId!,
      rootFolderId: form.rootFolderId!,
    })
    router.push(`/music/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    adding.value = undefined
  }
}
</script>
