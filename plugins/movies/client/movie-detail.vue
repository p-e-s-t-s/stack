<template>
  <section v-if="movie" class="mv">
    <a class="mp-back" href="/movies" @click.prevent="router.push('/movies')">← Movies</a>
    <div class="mp-hero">
      <img v-if="movie.posterUrl" class="poster" :src="movie.posterUrl" alt="" />
      <div v-else class="poster placeholder">{{ movie.title }}</div>
      <div class="info">
        <h1>
          {{ movie.title }} <span class="mp-muted year">{{ movie.year }}</span>
        </h1>
        <div class="facts mp-muted">
          <span v-if="movie.runtimeMinutes">{{ movie.runtimeMinutes }} min</span>
          <span v-if="movie.genres.length">{{ movie.genres.join(', ') }}</span>
          <span>{{ profileName }}</span>
          <span>{{ movie.monitored ? 'Monitored' : 'Not monitored' }}</span>
        </div>
        <div class="status">
          <span class="mp-badge" :class="status.class">{{ status.text }}</span>
          <span v-if="!movie.available" class="mp-muted mp-small">{{ availability }}</span>
        </div>
        <p class="overview">{{ movie.overview }}</p>
        <div class="mp-row">
          <button
            class="primary"
            data-testid="search-now"
            :disabled="busy === 'search-now'"
            @click="searchNow"
          >
            {{ busy === 'search-now' ? 'Searching…' : 'Search now' }}
          </button>
          <button data-testid="interactive-search" :disabled="searching" @click="search">
            {{ searching ? 'Searching…' : 'Choose a release' }}
          </button>
          <button data-testid="edit-movie" @click="editing = !editing">Edit</button>
          <button :disabled="busy === 'refresh'" @click="refresh">Refresh</button>
          <button class="danger" @click="remove">Remove</button>
        </div>
        <p v-if="message" class="mp-small" :class="messageBad ? 'mp-error' : 'mp-muted'">
          {{ message }}
        </p>
      </div>
    </div>

    <div v-if="editing" class="mp-card mp-edit">
      <div class="mp-field">
        <label>Quality profile</label>
        <select
          :value="movie.profileId"
          @change="update({ profileId: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="mp-field">
        <label>Download when</label>
        <select
          :value="movie.minimumAvailability"
          @change="
            update({ minimumAvailability: ($event.target as HTMLSelectElement).value as any })
          "
        >
          <option value="announced">Announced</option>
          <option value="inCinemas">In cinemas</option>
          <option value="released">Released (digital or disc)</option>
        </select>
      </div>
      <div class="mp-field">
        <label>Monitored</label>
        <div>
          <input
            type="checkbox"
            :checked="movie.monitored"
            @change="update({ monitored: ($event.target as HTMLInputElement).checked })"
          />
        </div>
        <span class="mp-help">Monitored movies are searched and upgraded automatically.</span>
      </div>
    </div>

    <h2>File</h2>
    <div class="mp-card">
      <template v-if="movie.download">
        <div class="mp-row">
          <strong>{{ downloadLabel(movie.download.state) }}</strong>
          <span class="mp-muted">{{ (movie.download.progress * 100).toFixed(0) }}%</span>
        </div>
        <div class="mp-progress" style="margin-top: 8px">
          <div :style="{ width: `${movie.download.progress * 100}%` }" />
        </div>
      </template>
      <template v-else-if="movie.file">
        <div class="mp-row">
          <span class="mono">{{ movie.file.path }}</span>
          <span class="mp-badge">{{ movie.file.quality }}</span>
          <span class="mp-muted">{{ gb(movie.file.size) }}</span>
        </div>
      </template>
      <p v-else class="mp-muted" style="margin: 0">No file yet.</p>
      <p class="mp-muted mp-small folder">{{ folder }}</p>
    </div>

    <template v-if="results || searchError">
      <h2>Releases</h2>
      <p v-if="searchError" class="mp-error">{{ searchError }}</p>
      <p v-for="e in indexerErrors" :key="e.indexer" class="mp-error mp-small">
        {{ e.indexer }}: {{ e.message }}
      </p>
      <table v-if="results" class="mp-table releases" data-testid="releases">
        <thead>
          <tr>
            <th>Release</th>
            <th>Quality</th>
            <th>Size</th>
            <th>Peers</th>
            <th>Age</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-if="!results.length">
            <td colspan="6" class="mp-muted">No releases found.</td>
          </tr>
          <tr v-for="r in results" :key="r.guid" :class="{ rejected: !r.accepted }">
            <td>
              <a
                v-if="r.infoUrl"
                class="release"
                :href="r.infoUrl"
                target="_blank"
                rel="noreferrer"
                >{{ r.title }}</a
              ><span v-else class="release">{{ r.title }}</span>
              <div class="mp-small mp-muted">
                {{ r.indexer
                }}<template v-if="r.matchedFormats.length">
                  · {{ r.matchedFormats.join(', ') }} ({{ r.formatScore }})</template
                >
              </div>
              <div v-if="r.rejections.length" class="mp-small mp-error">
                {{ r.rejections.map((x) => x.reason).join(' · ') }}
              </div>
            </td>
            <td>{{ r.quality }}</td>
            <td>{{ r.size ? gb(r.size) : '' }}</td>
            <td>
              {{ r.protocol === 'torrent' ? `${r.seeders ?? '?'} / ${r.leechers ?? '?'}` : '' }}
            </td>
            <td>{{ age(r.publishedAt) }}</td>
            <td class="actions">
              <button
                :class="{ primary: r.accepted && !grabbed.has(r.guid) }"
                :data-testid="'grab-' + r.guid"
                :title="r.accepted ? 'Download this release' : 'Download anyway'"
                :disabled="grabbing === r.guid || grabbed.has(r.guid)"
                @click="grab(r)"
              >
                {{ grabbed.has(r.guid) ? 'Sent' : 'Download' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- other plugins add sections here (history…) -->
    <k-slot name="movie-detail" :data="{ movie }" />
  </section>
  <section v-else class="mv"><p class="mp-empty">Movie not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import type { MoviesData, ReleaseRow } from '../src/console'
import { downloadLabel, gb, movieStatus } from './status'

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

const grabbing = ref<string>()
const grabbed = ref(new Set<string>())
async function grab(r: ReleaseRow) {
  grabbing.value = r.guid
  searchError.value = ''
  try {
    await data.value.grab(movie.value!.id, r.guid)
    grabbed.value.add(r.guid)
  } catch (e) {
    searchError.value = (e as Error).message
  } finally {
    grabbing.value = undefined
  }
}

const status = computed(() => movieStatus(movie.value!))
const profileName = computed(
  () => data.value.profiles.find((p) => p.id === movie.value?.profileId)?.name ?? '',
)
const availability = computed(() => {
  const m = movie.value!
  const date =
    m.minimumAvailability === 'announced'
      ? undefined
      : m.minimumAvailability === 'inCinemas'
        ? m.inCinemas
        : (m.digitalRelease ?? m.physicalRelease)
  return date ? `Magpie starts looking on ${date}.` : 'Magpie waits for a release date.'
})

const editing = ref(false)
const busy = ref<string>()
const message = ref('')
const messageBad = ref(false)
function say(text: string, bad = false) {
  message.value = text
  messageBad.value = bad
}

async function searchNow() {
  busy.value = 'search-now'
  say('')
  try {
    say(await data.value.searchNow(movie.value!.id))
  } catch (e) {
    say((e as Error).message, true)
  } finally {
    busy.value = undefined
  }
}

async function refresh() {
  busy.value = 'refresh'
  try {
    await data.value.refresh(movie.value!.id)
    say('Updated from TMDB.')
  } catch (e) {
    say((e as Error).message, true)
  } finally {
    busy.value = undefined
  }
}

function age(date?: string) {
  if (!date) return ''
  const days = (Date.now() - Date.parse(date)) / 86_400_000
  return days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${Math.round(days)} d`
}

async function remove() {
  if (!confirm(`Remove ${movie.value!.title} from Magpie?`)) return
  const deleteFiles = !!movie.value!.file && confirm('Also delete its folder and files from disk?')
  await data.value.remove(movie.value!.id, deleteFiles)
  router.push('/movies')
}
</script>
