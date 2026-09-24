<template>
  <section v-if="podcast" class="pc">
    <a class="back" href="/podcasts" @click.prevent="router.push('/podcasts')">← Podcasts</a>
    <div class="hero">
      <img v-if="podcast.posterUrl" class="poster" :src="podcast.posterUrl" alt="" />
      <div v-else class="poster placeholder">{{ podcast.title }}</div>
      <div class="info">
        <h1>{{ podcast.title }}</h1>
        <div class="facts mp-muted">
          <span v-if="podcast.author">{{ podcast.author }}</span>
          <a v-if="podcast.link" :href="podcast.link" target="_blank" rel="noreferrer">Website</a>
          <span v-if="podcast.stats.latest">Latest {{ day(podcast.stats.latest) }}</span>
          <span v-if="podcast.refreshedAt"
            >Checked {{ new Date(podcast.refreshedAt).toLocaleString() }}</span
          >
        </div>
        <div class="status">
          <span class="mp-badge" :class="status.class">{{ status.text }}</span>
          <span class="mp-muted mp-small count">
            {{ podcast.stats.downloaded }} of {{ podcast.stats.episodes }} episodes downloaded
          </span>
        </div>
        <p v-if="podcast.refreshError" class="mp-error mp-small">
          The feed could not be read: {{ podcast.refreshError }}
        </p>
        <p class="overview">{{ podcast.overview }}</p>
        <div class="mp-row">
          <button
            class="primary"
            data-testid="download-wanted"
            :disabled="busy === 'download' || !podcast.stats.wanted"
            @click="download()"
          >
            Download wanted
          </button>
          <button data-testid="edit-podcast" @click="editing = !editing">Settings</button>
          <button :disabled="busy === 'refresh'" data-testid="refresh" @click="refresh">
            {{ busy === 'refresh' ? 'Checking…' : 'Check feed' }}
          </button>
          <button class="danger" @click="remove">Remove</button>
        </div>
        <p v-if="message" class="mp-small" :class="messageBad ? 'mp-error' : 'mp-muted'">
          {{ message }}
        </p>
      </div>
    </div>

    <div v-if="editing" class="mp-card edit">
      <div class="mp-field">
        <label>Following</label>
        <div>
          <input
            type="checkbox"
            :checked="podcast.monitored"
            @change="update({ monitored: ($event.target as HTMLInputElement).checked })"
          />
        </div>
        <span class="mp-help">Paused podcasts are still checked, but nothing is downloaded.</span>
      </div>
      <div class="mp-field">
        <label>Download new episodes</label>
        <div>
          <input
            type="checkbox"
            :checked="podcast.monitorNew"
            data-testid="monitor-new"
            @change="update({ monitorNew: ($event.target as HTMLInputElement).checked })"
          />
        </div>
      </div>
      <div class="mp-field">
        <label>Keep</label>
        <select
          :value="podcast.keepLatest ?? ''"
          data-testid="keep-latest"
          @change="keep(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Every downloaded episode</option>
          <option v-for="n in keepChoices" :key="n" :value="n">The newest {{ n }}</option>
        </select>
        <span class="mp-help">Older files go to the recycle bin (or are deleted).</span>
      </div>
      <p class="folder mp-muted mp-small mono">{{ podcast.feedUrl }}</p>
    </div>

    <div class="mp-head">
      <h2>Episodes</h2>
      <input v-if="episodes?.length" v-model="filter" placeholder="Filter" class="filter" />
    </div>
    <p v-if="!episodes" class="mp-muted">Loading…</p>
    <p v-else-if="!episodes.length" class="mp-empty">This feed has no episodes.</p>
    <table v-else class="mp-table episodes">
      <tbody>
        <tr
          v-for="e in shown"
          :key="e.id"
          :class="{ off: !e.monitored && !e.file }"
          :data-testid="`episode-${e.id}`"
        >
          <td class="mon">
            <input
              type="checkbox"
              :checked="e.monitored"
              title="Download this episode"
              @change="data.monitorEpisode(e.id, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td>
            <div>{{ e.title }}</div>
            <div v-if="e.file" class="mp-muted mp-small mono">{{ e.file.path }}</div>
            <div v-else-if="e.failed && e.lastError" class="mp-error mp-small">
              {{ e.lastError }}
            </div>
            <div v-else-if="e.description" class="mp-muted mp-small desc">
              {{ e.description }}
            </div>
          </td>
          <td class="date mp-muted">{{ day(e.publishedAt) }}</td>
          <td class="len mp-muted">{{ duration(e.durationSeconds) }}</td>
          <td class="actions">
            <span v-if="episodeStatus(e).text" class="mp-badge" :class="episodeStatus(e).class">{{
              episodeStatus(e).text
            }}</span>
            <button
              v-if="!e.file && !e.download"
              class="small"
              :data-testid="`download-${e.id}`"
              @click="download([e.id])"
            >
              Download
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <button v-if="filtered.length > limit" class="more" @click="limit += 100">
      Show {{ Math.min(100, filtered.length - limit) }} more
    </button>

    <!-- other plugins add sections here (history…) -->
    <k-slot name="podcast-detail" :data="{ podcast }" />
  </section>
  <section v-else class="pc"><p class="mp-empty">Podcast not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import type { PodcastEpisodeRow, PodcastsData } from '../src/console'
import { day, duration, episodeStatus, podcastStatus } from './status'

const data = useRpc<PodcastsData>()
const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const podcast = computed(() => data.value.podcasts.find((p) => p.id === id.value))
const status = computed(() => podcastStatus(podcast.value!))
const keepChoices = computed(() =>
  [...new Set([1, 3, 5, 10, 25, podcast.value?.keepLatest ?? 1])].sort((a, b) => a - b),
)

// episodes are fetched per podcast, and again whenever this podcast changes
const episodes = ref<PodcastEpisodeRow[]>()
watch(
  () => [id.value, data.value.revision[id.value]] as const,
  async ([podcastId]) => {
    if (!Number.isFinite(podcastId)) return
    episodes.value = await data.value.episodes(podcastId)
  },
  { immediate: true },
)

const filter = ref('')
const limit = ref(50)
const filtered = computed(() =>
  (episodes.value ?? []).filter((e) => e.title.toLowerCase().includes(filter.value.toLowerCase())),
)
const shown = computed(() => filtered.value.slice(0, limit.value))

const editing = ref(false)
const busy = ref<string>()
const message = ref('')
const messageBad = ref(false)
function say(text: string, bad = false) {
  message.value = text
  messageBad.value = bad
}

async function run(what: string, fn: () => Promise<string | void>) {
  busy.value = what
  say('')
  try {
    const text = await fn()
    if (text) say(text)
  } catch (e) {
    say((e as Error).message, true)
  } finally {
    busy.value = undefined
  }
}

const update = (patch: Parameters<PodcastsData['update']>[1]) =>
  run('update', () => data.value.update(podcast.value!.id, patch))

function keep(value: string) {
  const n = value ? Number(value) : null
  if (n && n < podcast.value!.stats.downloaded)
    if (!confirm(`Keep only the newest ${n}? Older downloaded episodes will be removed.`)) return
  void update({ keepLatest: n })
}

const download = (episodeIds?: number[]) =>
  run('download', () => data.value.download(podcast.value!.id, episodeIds))

const refresh = () =>
  run('refresh', async () => {
    await data.value.refresh(podcast.value!.id)
    return 'Feed checked.'
  })

async function remove() {
  if (!confirm(`Stop following ${podcast.value!.title}?`)) return
  const deleteFiles =
    podcast.value!.stats.downloaded > 0 && confirm('Also delete its folder and files from disk?')
  await data.value.remove(podcast.value!.id, deleteFiles)
  router.push('/podcasts')
}
</script>
