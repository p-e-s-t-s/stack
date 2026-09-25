<template>
  <div ref="el" class="releases-panel">
    <div class="mp-head">
      <h2>Releases for {{ label }}</h2>
      <button class="small" @click="emit('close')">Close</button>
    </div>
    <p v-if="searching" class="mp-muted">Searching…</p>
    <p v-if="error" class="mp-error">{{ error }}</p>
    <p v-for="err in errors" :key="err.indexer" class="mp-error mp-small">
      {{ err.indexer }}: {{ err.message }}
    </p>
    <table v-if="results" class="mp-table releases" data-testid="releases">
      <thead>
        <tr>
          <th>Release</th>
          <th v-if="showUnitColumn">Covers</th>
          <th>Quality</th>
          <th>Size</th>
          <th>Peers</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!results.length">
          <td :colspan="showUnitColumn ? 6 : 5" class="mp-muted">No releases found.</td>
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
            >
            <span v-else class="release">{{ r.title }}</span>
            <div class="mp-small mp-muted">
              {{ r.indexer }}<template v-if="!showUnitColumn && r.unit"> · {{ r.unit }}</template
              ><template v-if="r.matchedFormats.length">
                · {{ r.matchedFormats.join(', ') }} ({{ r.formatScore }})</template
              >
            </div>
            <div v-if="r.rejections.length" class="mp-small mp-error">
              {{ r.rejections.map((x) => x.reason).join(' · ') }}
            </div>
          </td>
          <td v-if="showUnitColumn" style="white-space: nowrap">{{ r.unit }}</td>
          <td>{{ r.quality }}</td>
          <td>{{ r.size ? fileSize(r.size) : '' }}</td>
          <td>
            {{ r.protocol === 'torrent' ? `${r.seeders ?? '?'} / ${r.leechers ?? '?'}` : '' }}
          </td>
          <td class="actions">
            <button
              :class="{ primary: r.accepted && !grabbed.has(r.guid) }"
              :data-testid="'grab-' + r.guid"
              :disabled="grabbing === r.guid || grabbed.has(r.guid)"
              @click="handleGrab(r)"
            >
              {{ grabbed.has(r.guid) ? 'Sent' : 'Download' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue'
import { fileSize, type ReleaseRow } from './status'

/**
 * A search-and-grab panel for the releases of one item (or, for series, one season): the
 * caller keeps the picker's own open/closed state and supplies `search`/`grab` already bound
 * to the item and the parts being searched for.
 */
const props = defineProps<{
  label: string
  search: () => Promise<{ results: ReleaseRow[]; errors: { indexer: string; message: string }[] }>
  grab: (guid: string) => Promise<void>
  /**
   * Shows which part of the item each release covers as its own column instead of folding it
   * into the release name (series opens the picker per season, where releases can cover
   * different episodes; books and music always pick for one part, so it reads better as a
   * one-line mention next to the title than as a column that repeats the same value).
   */
  showUnitColumn?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const el = ref<HTMLElement>()
const searching = ref(true)
const results = ref<ReleaseRow[]>()
const errors = ref<{ indexer: string; message: string }[]>([])
const error = ref('')
const grabbing = ref<string>()
const grabbed = reactive(new Set<string>())

onMounted(async () => {
  el.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try {
    const outcome = await props.search()
    results.value = outcome.results
    errors.value = outcome.errors
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    searching.value = false
  }
})

async function handleGrab(r: ReleaseRow) {
  grabbing.value = r.guid
  error.value = ''
  try {
    await props.grab(r.guid)
    grabbed.add(r.guid)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    grabbing.value = undefined
  }
}
</script>
