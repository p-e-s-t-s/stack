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
          <th>Quality</th>
          <th>Size</th>
          <th>Peers</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!results.length">
          <td colspan="5" class="mp-muted">No releases found.</td>
        </tr>
        <tr v-for="r in results" :key="r.guid" :class="{ rejected: !r.accepted }">
          <td>
            <span class="release">{{ r.title }}</span>
            <div class="mp-small mp-muted">
              {{ r.indexer }}<template v-if="r.album"> · {{ r.album }}</template
              ><template v-if="r.matchedFormats.length">
                · {{ r.matchedFormats.join(', ') }} ({{ r.formatScore }})</template
              >
            </div>
            <div v-if="r.rejections.length" class="mp-small mp-error">
              {{ r.rejections.map((x) => x.reason).join(' · ') }}
            </div>
          </td>
          <td>{{ r.quality }}</td>
          <td>{{ r.size ? mb(r.size) : '' }}</td>
          <td>
            {{ r.protocol === 'torrent' ? `${r.seeders ?? '?'} / ${r.leechers ?? '?'}` : '' }}
          </td>
          <td class="actions">
            <button
              :class="{ primary: r.accepted && !grabbed.has(r.guid) }"
              :disabled="grabbing === r.guid || grabbed.has(r.guid)"
              @click="grab(r)"
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
import { useRpc } from '@cordisjs/client'
import type { MusicData, ReleaseRow } from '../src/console'
import { mb } from './status'

const props = defineProps<{ artistId: number; albumIds: number[]; label: string }>()
const emit = defineEmits<{ close: [] }>()
const data = useRpc<MusicData>()
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
    const outcome = await data.value.search(props.artistId, props.albumIds)
    results.value = outcome.results
    errors.value = outcome.errors
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    searching.value = false
  }
})

async function grab(r: ReleaseRow) {
  grabbing.value = r.guid
  error.value = ''
  try {
    await data.value.grab(props.artistId, r.guid)
    grabbed.add(r.guid)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    grabbing.value = undefined
  }
}
</script>
