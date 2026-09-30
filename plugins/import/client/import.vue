<template>
  <section class="import-page">
    <div class="mp-head"><h1>Import &amp; repair</h1></div>
    <p class="mp-lead">Scan a folder, review the matches, then import the selected files.</p>
    <form class="mp-card" @submit.prevent="scan">
      <div class="mp-row">
        <label
          >Workflow
          <select v-model="mode">
            <option value="adopt">Import existing library</option>
            <option value="manual">Manual import</option>
            <option value="rescan">Rescan files</option>
            <option value="repair">Repair file records</option>
          </select></label
        >
        <label
          >Media
          <select v-model="kind">
            <option v-for="k in data.kinds" :key="k" :value="k">
              {{ k === 'movie' ? 'Movies' : 'Series' }}
            </option>
          </select></label
        >
        <label
          >Library item
          <select v-model="mediaId" @change="chooseItem">
            <option :value="0">Choose per file</option>
            <option v-for="i in items" :key="i.id" :value="i.id">{{ i.title }}</option>
          </select></label
        >
      </div>
      <label class="path"
        >Folder on server
        <input v-model="path" placeholder="Absolute path visible to Magpie" required
      /></label>
      <button class="primary" :disabled="busy || !path">
        {{ busy ? 'Working…' : 'Scan folder' }}
      </button>
    </form>
    <p v-if="error" class="mp-error" role="alert">{{ error }}</p>
    <div v-if="data.failed.length" class="mp-card">
      <h2>Failed imports</h2>
      <div v-for="g in data.failed" :key="g.id" class="mp-row">
        <span>{{ g.title }} — {{ g.error }}</span
        ><button :disabled="busy" @click="repairGrab(g.id)">Review files</button>
      </div>
    </div>
    <div v-if="data.operations.length" class="mp-card" data-testid="operations">
      <h2>Recent imports</h2>
      <p class="mp-muted mp-small">
        Undo puts files back as they were. Replaced files are kept for the undo period set in Media
        management.
      </p>
      <div v-for="o in data.operations.slice(0, 10)" :key="o.batchId" class="mp-row op">
        <span>{{ o.title }}</span>
        <span class="mp-muted mp-small">{{ new Date(o.createdAt).toLocaleString() }}</span>
        <button
          v-if="o.state.state === 'available'"
          :disabled="busy"
          @click="reviewUndo({ batchId: o.batchId })"
        >
          Undo{{ o.count > 1 ? ` (${o.state.count})` : '' }}
        </button>
        <span v-else-if="o.state.state === 'undone'" class="mp-badge">Undone</span>
        <span v-else class="mp-muted mp-small">{{ o.state.reason }}</span>
      </div>
    </div>
    <div v-if="undoPlan" class="mp-card" data-testid="undo-plan">
      <h2>Undo</h2>
      <p v-if="undoPlan.problems.length" class="mp-error">
        Some of this can’t be undone right now:
        <span v-for="p in undoPlan.problems" :key="p" style="display: block">{{ p }}</span>
      </p>
      <p>This will:</p>
      <ul>
        <li v-for="line in undoPlan.lines" :key="line">{{ line }}</li>
      </ul>
      <div class="mp-row">
        <button class="primary" :disabled="busy" @click="confirmUndo">
          {{ busy ? 'Working…' : 'Undo' }}
        </button>
        <button :disabled="busy" @click="undoPlan = undefined">Cancel</button>
      </div>
    </div>
    <p v-if="undoMessage" class="mp-muted" role="status">{{ undoMessage }}</p>
    <div class="mp-row" v-if="data.sessions.length">
      <label
        >Resume scan
        <select @change="resume(Number(($event.target as HTMLSelectElement).value))">
          <option value="0">Choose a scan</option>
          <option v-for="s in data.sessions" :key="s.id" :value="s.id">
            #{{ s.id }} {{ s.mode }} — {{ s.path }}{{ s.complete ? ' (complete)' : '' }}
          </option>
        </select></label
      >
    </div>
    <template v-if="session">
      <h2>{{ session.rows.length }} files · {{ session.path }}</h2>
      <div class="mp-row">
        <button @click="selectAll" :disabled="busy">Select pending files</button>
        <label v-if="session.mode === 'manual'"
          >Transfer
          <select v-model="session.transfer" @change="dirty = true">
            <option value="hardlink">Hardlink (copy if needed)</option>
            <option value="copy">Copy</option>
            <option value="move">Move</option>
          </select></label
        >
        <label v-if="session.missing.length"
          ><input type="checkbox" v-model="session.removeMissing" @change="dirty = true" /> Remove
          {{ session.missing.length }} missing file records after rechecking</label
        >
      </div>
      <p
        v-if="session.mode === 'adopt' || session.mode === 'rescan' || session.mode === 'repair'"
        class="mp-muted"
      >
        Files stay at their existing paths. Adoption defaults to unmonitored; enable monitoring when
        ready.
      </p>
      <div v-for="(row, index) in session.rows" :key="row.source" class="mp-card file-row">
        <div class="mp-row">
          <input
            type="checkbox"
            v-model="row.selected"
            :disabled="row.status === 'done'"
            @change="dirty = true"
          /><strong>{{ row.source }}</strong
          ><span class="mp-badge">{{ row.status }}</span>
        </div>
        <template v-if="row.status !== 'done'">
          <div class="mp-row">
            <label
              >Library item
              <select v-model="row.mediaId" @change="assignment(row)">
                <option :value="undefined">Choose metadata match</option>
                <option
                  v-for="i in data.items.filter((i) => i.kind === session!.kind)"
                  :key="i.id"
                  :value="i.id"
                >
                  {{ i.title }}
                </option>
              </select></label
            >
            <template v-if="!row.mediaId && session.mode === 'adopt'">
              <input v-model="row.term" placeholder="Search title" /><button
                :disabled="busy"
                @click="lookup(row)"
              >
                Find match
              </button>
              <label
                >Metadata match
                <select v-model="row.tmdbId" @change="applyMatch(row)">
                  <option :value="undefined">Choose a title</option>
                  <option
                    v-for="s in row.suggestions"
                    :key="s.ids.tmdb"
                    :value="Number(s.ids.tmdb)"
                  >
                    {{ s.title }} ({{ s.year }}){{ s.libraryId ? ' — in library' : '' }}
                  </option>
                </select></label
              >
              <label
                >Profile
                <select v-model="row.profileId" @change="applySettings(row)">
                  <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select></label
              >
              <label
                ><input type="checkbox" v-model="row.monitored" @change="applySettings(row)" />
                Monitor</label
              >
              <span class="mp-muted">Folder: {{ row.folder }}</span>
              <label v-if="session.kind === 'series'"
                >Series type
                <select v-model="row.seriesType" @change="applySettings(row)">
                  <option :value="undefined">Standard</option>
                  <option value="daily">Daily</option>
                  <option value="anime">Anime</option>
                </select></label
              >
            </template>
            <label
              >Quality
              <select v-model="row.quality" @change="dirty = true">
                <option v-for="q in data.qualities" :key="q.id" :value="q.id">{{ q.name }}</option>
              </select></label
            >
            <label>Release name <input v-model="row.releaseName" @change="dirty = true" /></label>
            <label
              >Languages
              <input
                :value="row.languages.join(', ')"
                @change="setLanguages(row, $event)"
                placeholder="en, ja"
            /></label>
            <label v-if="session.mode !== 'repair'"
              ><input type="checkbox" v-model="row.replace" @change="dirty = true" /> Replace
              conflicting files</label
            >
          </div>
          <div v-if="session.kind === 'series' && row.mediaId" class="mp-row">
            <button @click="loadEpisodes(row.mediaId!)" :disabled="busy">Choose episodes</button>
            <select
              v-if="episodes[row.mediaId]"
              multiple
              v-model="row.episodeIds"
              @change="dirty = true"
              aria-label="Episodes in this file"
            >
              <option v-for="e in episodes[row.mediaId]" :key="e.id" :value="e.id">
                S{{ e.season }}E{{ e.number }} — {{ e.title }}
              </option>
            </select>
            <span class="mp-muted">{{ row.episodeIds?.length ?? 0 }} episode(s) assigned</span>
          </div>
          <label v-if="session.kind === 'series' && !row.mediaId && row.episodeChoices"
            >Episodes in file
            <select multiple v-model="row.episodeKeys" @change="dirty = true">
              <option v-for="e in row.episodeChoices" :key="e.key" :value="e.key">
                {{ e.label }}
              </option>
            </select></label
          >
        </template>
        <p v-if="row.destination" class="mp-muted">Destination: {{ row.destination }}</p>
        <p v-if="row.conflicts?.length" class="mp-muted">
          {{ row.conflicts.length }} existing file record(s) affected
        </p>
        <p v-if="row.formatScore !== undefined" class="mp-muted">
          Custom format score: {{ row.formatScore }}
        </p>
        <p v-if="row.error" class="mp-error">{{ row.error }}</p>
        <span class="mp-muted mp-small"
          >File {{ index + 1 }} · {{ (row.size / 1048576).toFixed(1) }} MB</span
        >
      </div>
      <div class="mp-row">
        <button :disabled="busy" @click="preview">Review changes</button>
        <button class="primary" :disabled="busy || dirty || !ready" @click="commit">
          {{ busy ? 'Working…' : 'Import selected files' }}
        </button>
        <span v-if="dirty" class="mp-muted">Review changes before importing.</span>
        <span v-if="session.complete" class="mp-badge">Import complete</span>
      </div>
      <div v-if="sessionUndo.length" class="mp-card mp-row" data-testid="session-undo">
        <span>{{ sessionUndo.reduce((n, o) => n + o.count, 0) }} files changed.</span>
        <button :disabled="busy" @click="reviewUndo({ batchId: sessionUndo[0]!.batchId })">
          Undo all
        </button>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRpc } from '@cordisjs/client'
import type { ImportData } from '../src/console'
import type { UndoTarget } from '../src/undo'
import type { ReviewKind, ReviewRow, ReviewSession } from '../src/review'
const data = useRpc<ImportData>()
const route = useRoute()
const kind = ref<ReviewKind>('movie')
const mode = ref<ReviewSession['mode']>('adopt')
const mediaId = ref(0)
const path = ref('')
const error = ref('')
const busy = ref(false)
const dirty = ref(true)
const session = ref<ReviewSession>()
const episodes = ref<Record<number, Awaited<ReturnType<ImportData['episodes']>>>>({})
const items = computed(() => data.value.items.filter((i) => i.kind === kind.value))
const ready = computed(
  () =>
    session.value &&
    (session.value.rows.some(
      (r) =>
        r.selected &&
        r.status !== 'done' &&
        (!r.error || r.status === 'placed' || r.status === 'staged'),
    ) ||
      session.value.removeMissing),
)
// undoing: review what would move, then confirm
const undoPlan = ref<{ target: UndoTarget; lines: string[]; problems: string[] }>()
const undoMessage = ref('')
const sessionUndo = computed(() =>
  data.value.operations.filter(
    (o) => session.value?.batches?.includes(o.batchId) && o.state.state === 'available',
  ),
)
async function reviewUndo(target: UndoTarget) {
  await run(async () => {
    undoMessage.value = ''
    undoPlan.value = { target, ...(await data.value.undoPlan(target)) }
  })
}
async function confirmUndo() {
  const target = undoPlan.value?.target
  if (!target) return
  await run(async () => {
    const outcome = await data.value.undo(target)
    undoPlan.value = undefined
    undoMessage.value = outcome.ok
      ? ['Undone.', ...outcome.warnings].join(' ')
      : `Not undone: ${outcome.reasons.join('; ')}`
  })
}
async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
function chooseItem() {
  const i = data.value.items.find((i) => i.id === mediaId.value)
  if (i && mode.value !== 'manual') path.value = i.path
}
async function scan() {
  await run(async () => {
    session.value = await data.value.scan({
      kind: kind.value,
      mode: mode.value,
      path: path.value,
      mediaId: mediaId.value || undefined,
    })
    dirty.value = true
  })
}
function resume(id: number) {
  const found = data.value.sessions.find((s) => s.id === id)
  if (found) {
    session.value = JSON.parse(JSON.stringify(found))
    dirty.value = true
  }
}
function selectAll() {
  session.value?.rows.forEach((r) => {
    if (r.status !== 'done') r.selected = true
  })
  dirty.value = true
}
function assignment(row: ReviewRow) {
  row.episodeIds = undefined
  row.selected = true
  dirty.value = true
}
function setLanguages(row: ReviewRow, event: Event) {
  row.languages = (event.target as HTMLInputElement).value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  dirty.value = true
}
function applyMatch(row: ReviewRow) {
  for (const r of session.value!.rows.filter(
    (r) => r.folder === row.folder && r.status !== 'done',
  )) {
    r.tmdbId = row.tmdbId
    r.profileId = row.profileId
    r.selected = true
  }
  dirty.value = true
}
function applySettings(row: ReviewRow) {
  for (const r of session.value!.rows.filter(
    (r) => r.folder === row.folder && r.status !== 'done',
  )) {
    r.profileId = row.profileId
    r.monitored = row.monitored
    r.seriesType = row.seriesType
  }
  dirty.value = true
}
async function lookup(row: ReviewRow) {
  await run(async () => {
    row.suggestions = await data.value.lookup(session.value!.kind, row.term)
  })
}
async function loadEpisodes(id: number) {
  await run(async () => {
    episodes.value[id] = await data.value.episodes(session.value!.kind, id)
  })
}
async function preview() {
  await run(async () => {
    const s = session.value!
    session.value = await data.value.preview(s.id, s.rows, s.transfer, s.removeMissing)
    dirty.value = false
  })
}
async function commit() {
  await run(async () => {
    session.value = await data.value.commit(session.value!.id)
  })
}
async function repairGrab(id: number) {
  await run(async () => {
    session.value = await data.value.repairGrab(id)
    dirty.value = true
  })
}
watch(
  () => [route.query.mediaId, data.value.items.length],
  () => {
    const i = data.value.items.find((i) => i.id === Number(route.query.mediaId))
    if (i) {
      kind.value = i.kind as ReviewKind
      mediaId.value = i.id
      mode.value = route.query.mode === 'repair' ? 'repair' : 'rescan'
      path.value = i.path
    }
  },
  { immediate: true },
)
watch(
  () => route.query.kind,
  (k) => {
    if (k === 'movie' || k === 'series') kind.value = k
  },
  { immediate: true },
)
watch(
  () => route.query.grabId,
  (id) => {
    if (id) void repairGrab(Number(id))
  },
  { immediate: true },
)
</script>
<style scoped>
.import-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.path {
  display: flex;
  margin: 16px 0;
}
.path input {
  flex: 1;
}
.file-row {
  margin: 16px 0;
  overflow-wrap: anywhere;
}
.file-row .mp-row {
  margin: 12px 0;
  flex-wrap: wrap;
}
select[multiple] {
  min-width: 300px;
  min-height: 120px;
}
</style>
