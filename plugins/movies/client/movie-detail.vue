<template>
  <section v-if="movie" class="mv">
    <div class="detail">
      <img v-if="movie.posterUrl" class="poster" :src="movie.posterUrl" />
      <div style="flex: 1">
        <h1 style="margin-top: 0">
          {{ movie.title }} <span class="muted">({{ movie.year }})</span>
        </h1>
        <p>{{ movie.overview }}</p>
        <table>
          <tbody>
            <tr v-if="movie.runtimeMinutes">
              <th>Runtime</th>
              <td>{{ movie.runtimeMinutes }} min</td>
            </tr>
            <tr v-if="movie.genres.length">
              <th>Genres</th>
              <td>{{ movie.genres.join(', ') }}</td>
            </tr>
            <tr v-if="movie.inCinemas">
              <th>In cinemas</th>
              <td>{{ movie.inCinemas }}</td>
            </tr>
            <tr v-if="movie.digitalRelease">
              <th>Digital</th>
              <td>{{ movie.digitalRelease }}</td>
            </tr>
            <tr v-if="movie.physicalRelease">
              <th>Physical</th>
              <td>{{ movie.physicalRelease }}</td>
            </tr>
            <tr>
              <th>Folder</th>
              <td class="muted">{{ folder }}</td>
            </tr>
            <tr>
              <th>File</th>
              <td>
                {{
                  movie.file
                    ? `${movie.file.path} · ${movie.file.quality} · ${(movie.file.size / 1024 ** 3).toFixed(1)} GB`
                    : 'none yet'
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <div class="row">
          <label>Profile</label>
          <select
            :value="movie.profileId"
            @change="update({ profileId: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label>Available when</label>
          <select
            :value="movie.minimumAvailability"
            @change="
              update({ minimumAvailability: ($event.target as HTMLSelectElement).value as any })
            "
          >
            <option value="announced">Announced</option>
            <option value="inCinemas">In cinemas</option>
            <option value="released">Released</option>
          </select>
          <label
            ><input
              type="checkbox"
              :checked="movie.monitored"
              @change="update({ monitored: ($event.target as HTMLInputElement).checked })"
            />
            Monitored</label
          >
          <button @click="data.refresh(movie.id)">Refresh</button>
          <button class="danger" @click="remove">Remove</button>
        </div>
      </div>
    </div>
    <h2>Search</h2>
    <div class="row">
      <button
        class="primary"
        data-testid="interactive-search"
        :disabled="searching"
        @click="search"
      >
        {{ searching ? 'Searching…' : 'Interactive search' }}
      </button>
      <span v-if="searchError" class="error">{{ searchError }}</span>
      <span v-for="e in indexerErrors" :key="e.indexer" class="error"
        >{{ e.indexer }}: {{ e.message }}</span
      >
    </div>
    <table v-if="results" class="mp-card releases" data-testid="releases">
      <thead>
        <tr>
          <th>Release</th>
          <th>Indexer</th>
          <th>Quality</th>
          <th>Score</th>
          <th>Size</th>
          <th>Peers</th>
          <th>Age</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!results.length">
          <td colspan="8" class="muted">No results.</td>
        </tr>
        <tr v-for="r in results" :key="r.guid" :class="{ rejected: !r.accepted }">
          <td class="release">
            <a v-if="r.infoUrl" :href="r.infoUrl" target="_blank" rel="noreferrer">{{ r.title }}</a
            ><span v-else>{{ r.title }}</span>
            <div v-if="r.rejections.length" class="reasons">
              {{ r.rejections.map((x) => x.reason).join(' · ') }}
            </div>
            <div v-else-if="r.matchedFormats.length" class="muted">
              {{ r.matchedFormats.join(', ') }}
            </div>
          </td>
          <td>{{ r.indexer }}</td>
          <td>{{ r.quality }}</td>
          <td>{{ r.formatScore }}</td>
          <td>{{ r.size ? (r.size / 1024 ** 3).toFixed(1) + ' GB' : '' }}</td>
          <td>{{ r.protocol === 'torrent' ? `${r.seeders ?? '?'}/${r.leechers ?? '?'}` : '' }}</td>
          <td>{{ age(r.publishedAt) }}</td>
          <td>
            <span :class="r.accepted ? 'ok' : 'no'">{{ r.accepted ? '✓' : '✕' }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- other plugins add sections here (history, grab…) -->
    <k-slot name="movie-detail" :data="{ movie }" />
  </section>
  <section v-else class="mv"><p class="muted">Movie not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import type { MoviesData, ReleaseRow } from '../src/console'

const data = useRpc<MoviesData>()
const route = useRoute()
const router = useRouter()
const movie = computed(() => data.value.movies.find((m) => m.id === Number(route.params.id)))
const folder = computed(() => {
  const root = data.value.rootFolders.find((f) => f.id === movie.value?.rootFolderId)
  return root ? `${root.path}/${movie.value!.folder}` : movie.value?.folder
})

const update = (patch: Parameters<MoviesData['update']>[1]) =>
  data.value.update(movie.value!.id, patch)

const results = ref<ReleaseRow[]>()
const indexerErrors = ref<{ indexer: string; message: string }[]>([])
const searchError = ref('')
const searching = ref(false)
watch(
  () => route.params.id,
  () => (results.value = undefined),
)

async function search() {
  searching.value = true
  searchError.value = ''
  try {
    const outcome = await data.value.search(movie.value!.id)
    results.value = outcome.results
    indexerErrors.value = outcome.errors
  } catch (e) {
    searchError.value = (e as Error).message
  } finally {
    searching.value = false
  }
}

function age(date?: string) {
  if (!date) return ''
  const days = (Date.now() - Date.parse(date)) / 86_400_000
  return days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${Math.round(days)} d`
}

async function remove() {
  const deleteFiles = !!movie.value!.file && confirm('Also delete the movie folder and its files?')
  await data.value.remove(movie.value!.id, deleteFiles)
  router.push('/movies')
}
</script>
