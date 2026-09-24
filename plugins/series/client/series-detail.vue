<template>
  <section v-if="series" class="sr">
    <a class="back" href="/series" @click.prevent="router.push('/series')">← Series</a>
    <div class="hero">
      <img v-if="series.posterUrl" class="poster" :src="series.posterUrl" alt="" />
      <div v-else class="poster placeholder">{{ series.title }}</div>
      <div class="info">
        <h1>
          {{ series.title }} <span class="mp-muted year">{{ series.year }}</span>
        </h1>
        <div class="facts mp-muted">
          <span v-if="series.network">{{ series.network }}</span>
          <span v-if="series.status">{{ STATUS[series.status] ?? series.status }}</span>
          <span v-if="series.genres.length">{{ series.genres.join(', ') }}</span>
          <span>{{ profileName }}</span>
          <span v-if="series.seriesType !== 'standard'">{{ TYPES[series.seriesType] }}</span>
        </div>
        <div class="status">
          <span class="mp-badge" :class="status.class">{{ status.text }}</span>
          <span class="mp-muted mp-small count">
            {{ series.stats.downloaded }} of {{ series.stats.wanted }} aired episodes
            <template v-if="series.stats.nextAiring">
              · next on {{ series.stats.nextAiring }}</template
            >
          </span>
        </div>
        <p class="overview">{{ series.overview }}</p>
        <div class="mp-row">
          <button data-testid="edit-series" @click="editing = !editing">Edit</button>
          <button :disabled="busy === 'refresh'" @click="refresh">
            {{ busy === 'refresh' ? 'Refreshing…' : 'Refresh' }}
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
        <label>Quality profile</label>
        <select
          :value="series.profileId"
          @change="update({ profileId: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="mp-field">
        <label>Type</label>
        <select
          :value="series.seriesType"
          @change="update({ seriesType: ($event.target as HTMLSelectElement).value as any })"
        >
          <option value="standard">Standard</option>
          <option value="daily">Daily</option>
          <option value="anime">Anime</option>
        </select>
        <span class="mp-help"
          >Daily shows are matched by air date, anime also by absolute number.</span
        >
      </div>
      <div class="mp-field">
        <label>Season folders</label>
        <div>
          <input
            type="checkbox"
            :checked="series.seasonFolders"
            @change="update({ seasonFolders: ($event.target as HTMLInputElement).checked })"
          />
        </div>
      </div>
      <div class="mp-field">
        <label>Monitored</label>
        <div>
          <input
            type="checkbox"
            :checked="series.monitored"
            @change="update({ monitored: ($event.target as HTMLInputElement).checked })"
          />
        </div>
        <span class="mp-help">
          Unmonitored series aren't searched. Pick episodes and seasons below.
        </span>
      </div>
    </div>

    <h2>Episodes</h2>
    <p v-if="!episodes" class="mp-muted">Loading…</p>
    <details
      v-for="season in seasons"
      :key="season.number"
      class="season"
      :open="season.number === openSeason"
      :data-testid="`season-${season.number}`"
    >
      <summary>
        <input
          type="checkbox"
          :checked="season.monitored"
          title="Monitor this season"
          @click.stop
          @change="
            data.monitorSeason(
              series.id,
              season.number,
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        <h3>{{ seasonName(season.number) }}</h3>
        <span class="mp-muted mp-small count">{{ season.have }} / {{ season.aired }}</span>
        <span
          v-if="season.aired"
          class="mp-badge"
          :class="season.have >= season.aired ? 'ok' : season.monitored ? 'bad' : ''"
        >
          {{ season.have >= season.aired ? 'Complete' : `${season.aired - season.have} missing` }}
        </span>
      </summary>
      <table class="mp-table episodes">
        <tbody>
          <tr
            v-for="e in season.episodes"
            :key="e.id"
            :class="{ off: !e.monitored }"
            :data-testid="`episode-${e.season}-${e.number}`"
          >
            <td class="mon">
              <input
                type="checkbox"
                :checked="e.monitored"
                title="Monitor this episode"
                @change="data.monitorEpisode(e.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="num">
              {{ e.number
              }}<span v-if="series.seriesType === 'anime' && e.absoluteNumber" class="mp-small">
                ({{ e.absoluteNumber }})</span
              >
            </td>
            <td>
              {{ e.title ?? 'TBA' }}
              <div v-if="e.file" class="mp-muted mp-small mono">{{ e.file.path }}</div>
            </td>
            <td class="date mp-muted">{{ e.airDate ?? '' }}</td>
            <td class="actions">
              <span class="mp-badge" :class="episodeStatus(e).class">{{
                episodeStatus(e).text
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </details>

    <!-- other plugins add sections here (history…) -->
    <k-slot name="series-detail" :data="{ series }" />
  </section>
  <section v-else class="sr"><p class="mp-empty">Series not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import type { EpisodeRow, SeriesData } from '../src/console'
import { episodeStatus, seasonName, seriesStatus } from './status'

const STATUS: Record<string, string> = {
  continuing: 'Continuing',
  ended: 'Ended',
  upcoming: 'Upcoming',
}
const TYPES: Record<string, string> = { daily: 'Daily', anime: 'Anime', standard: 'Standard' }

const data = useRpc<SeriesData>()
const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const series = computed(() => data.value.series.find((s) => s.id === id.value))
const status = computed(() => seriesStatus(series.value!))
const profileName = computed(
  () => data.value.profiles.find((p) => p.id === series.value?.profileId)?.name ?? '',
)

// episodes are fetched per series, and again whenever this series changes
const episodes = ref<EpisodeRow[]>()
watch(
  () => [id.value, data.value.revision[id.value]] as const,
  async ([seriesId]) => {
    if (!Number.isFinite(seriesId)) return
    episodes.value = await data.value.episodes(seriesId)
  },
  { immediate: true },
)

const seasons = computed(() => {
  const all = episodes.value ?? []
  const monitoredSeasons = new Map(series.value?.seasons.map((s) => [s.number, s.monitored]))
  // newest season first, specials last
  const numbers = [...new Set(all.map((e) => e.season))].sort((a, b) =>
    a === 0 ? 1 : b === 0 ? -1 : b - a,
  )
  return numbers.map((number) => {
    const eps = all.filter((e) => e.season === number)
    const aired = eps.filter((e) => e.aired && e.monitored)
    return {
      number,
      monitored: monitoredSeasons.get(number) ?? false,
      episodes: eps,
      aired: aired.length,
      have: aired.filter((e) => e.file).length,
    }
  })
})
// open the newest season that has aired episodes
const openSeason = computed(
  () => seasons.value.find((s) => s.number > 0 && s.episodes.some((e) => e.aired))?.number,
)

const editing = ref(false)
const busy = ref<string>()
const message = ref('')
const messageBad = ref(false)
function say(text: string, bad = false) {
  message.value = text
  messageBad.value = bad
}

const update = (patch: Parameters<SeriesData['update']>[1]) =>
  data.value.update(series.value!.id, patch)

async function refresh() {
  busy.value = 'refresh'
  try {
    await data.value.refresh(series.value!.id)
    say('Updated from TMDB.')
  } catch (e) {
    say((e as Error).message, true)
  } finally {
    busy.value = undefined
  }
}

async function remove() {
  if (!confirm(`Remove ${series.value!.title} from Magpie?`)) return
  const deleteFiles =
    series.value!.stats.files > 0 && confirm('Also delete its folder and files from disk?')
  await data.value.remove(series.value!.id, deleteFiles)
  router.push('/series')
}
</script>
