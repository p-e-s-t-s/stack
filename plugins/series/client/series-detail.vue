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
          <button
            class="primary"
            data-testid="search-now"
            :disabled="busy === 'search'"
            @click="searchNow()"
          >
            {{ busy === 'search' ? 'Searching…' : 'Search monitored' }}
          </button>
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

    <div v-if="picker" ref="releasesEl" class="releases-panel">
      <div class="mp-head">
        <h2>Releases for {{ picker.label }}</h2>
        <button class="small" @click="picker = undefined">Close</button>
      </div>
      <p v-if="picker.searching" class="mp-muted">Searching…</p>
      <p v-if="picker.error" class="mp-error">{{ picker.error }}</p>
      <p v-for="err in picker.errors" :key="err.indexer" class="mp-error mp-small">
        {{ err.indexer }}: {{ err.message }}
      </p>
      <table v-if="picker.results" class="mp-table releases" data-testid="releases">
        <thead>
          <tr>
            <th>Release</th>
            <th>Covers</th>
            <th>Quality</th>
            <th>Size</th>
            <th>Peers</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-if="!picker.results.length">
            <td colspan="6" class="mp-muted">No releases found.</td>
          </tr>
          <tr v-for="r in picker.results" :key="r.guid" :class="{ rejected: !r.accepted }">
            <td>
              <span class="release">{{ r.title }}</span>
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
            <td style="white-space: nowrap">{{ r.covers }}</td>
            <td>{{ r.quality }}</td>
            <td>{{ r.size ? gb(r.size) : '' }}</td>
            <td>
              {{ r.protocol === 'torrent' ? `${r.seeders ?? '?'} / ${r.leechers ?? '?'}` : '' }}
            </td>
            <td class="actions">
              <button
                :class="{ primary: r.accepted && !picker.grabbed.has(r.guid) }"
                :data-testid="'grab-' + r.guid"
                :disabled="picker.grabbing === r.guid || picker.grabbed.has(r.guid)"
                @click="grab(r)"
              >
                {{ picker.grabbed.has(r.guid) ? 'Sent' : 'Download' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
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
        <span v-if="season.aired && season.have >= season.aired" class="mp-badge ok">Complete</span>
        <span v-else-if="season.missing" class="mp-badge bad">{{ season.missing }} missing</span>
        <button
          class="small"
          title="Search and download the missing episodes of this season"
          :disabled="busy === 'search'"
          @click.prevent="searchNow(missingOf(season.episodes), seasonName(season.number))"
        >
          Search
        </button>
        <button
          class="small"
          title="See all releases for this season"
          :data-testid="`choose-season-${season.number}`"
          @click.prevent="
            choose(
              season.episodes.map((e) => e.id),
              seasonName(season.number),
            )
          "
        >
          Choose
        </button>
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
              <button
                class="small"
                title="See releases for this episode"
                :data-testid="`choose-${e.season}-${e.number}`"
                @click="choose([e.id], label(e))"
              >
                Choose
              </button>
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
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import type { EpisodeRow, ReleaseRow, SeriesData } from '../src/console'
import { episodeStatus, gb, seasonName, seriesStatus } from './status'

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
    const aired = eps.filter((e) => e.aired)
    return {
      number,
      monitored: monitoredSeasons.get(number) ?? false,
      episodes: eps,
      aired: aired.length,
      have: aired.filter((e) => e.file).length,
      missing: aired.filter((e) => e.monitored && !e.file).length,
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

const pad = (n: number) => String(n).padStart(2, '0')
const label = (e: EpisodeRow) => `S${pad(e.season)}E${pad(e.number)}`
const missingOf = (eps: EpisodeRow[]) =>
  eps.filter((e) => e.monitored && e.aired && !e.file).map((e) => e.id)

async function searchNow(episodeIds?: number[], what = series.value!.title) {
  if (episodeIds && !episodeIds.length) return say(`Nothing is missing in ${what}.`)
  busy.value = 'search'
  say('')
  try {
    say(await data.value.searchNow(series.value!.id, episodeIds))
  } catch (e) {
    say((e as Error).message, true)
  } finally {
    busy.value = undefined
  }
}

interface Picker {
  label: string
  searching: boolean
  results?: ReleaseRow[]
  errors: { indexer: string; message: string }[]
  error?: string
  grabbing?: string
  grabbed: Set<string>
}
const picker = ref<Picker>()
const releasesEl = ref<HTMLElement>()

async function choose(episodeIds: number[], what: string) {
  const p = reactive<Picker>({ label: what, searching: true, errors: [], grabbed: new Set() })
  picker.value = p
  await nextTick()
  releasesEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try {
    const outcome = await data.value.search(series.value!.id, episodeIds)
    p.results = outcome.results
    p.errors = outcome.errors
  } catch (e) {
    p.error = (e as Error).message
  } finally {
    p.searching = false
  }
}

async function grab(r: ReleaseRow) {
  const p = picker.value!
  p.grabbing = r.guid
  p.error = undefined
  try {
    await data.value.grab(series.value!.id, r.guid)
    p.grabbed.add(r.guid)
  } catch (e) {
    p.error = (e as Error).message
  } finally {
    p.grabbing = undefined
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
