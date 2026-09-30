<template>
  <table class="mp-table hist">
    <thead>
      <tr>
        <th>When</th>
        <th v-if="showMedia">Movie</th>
        <th>Event</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="e in events" :key="e.id">
        <td class="mp-muted mp-small" style="white-space: nowrap">
          {{ new Date(e.createdAt).toLocaleString() }}
        </td>
        <td v-if="showMedia">{{ e.mediaTitle }}</td>
        <td>
          <span class="mp-badge" :class="BADGES[e.type]">{{ LABELS[e.type] }}</span>
        </td>
        <td>
          <div class="release">{{ e.title }}</div>
          <div class="mp-muted mp-small">{{ details(e) }}</div>
          <template v-if="e.undo">
            <div v-if="e.undo.state === 'available' && plan?.id !== e.id" class="mp-small">
              <button class="link" :disabled="busy" @click="review(e.id)">Undo</button>
            </div>
            <div v-else-if="e.undo.state === 'undone'" class="mp-muted mp-small">Undone</div>
            <div
              v-else-if="e.undo.state === 'unavailable' && e.undo.reason !== 'not recorded'"
              class="mp-muted mp-small"
              :title="e.undo.reason"
            >
              Can’t be undone: {{ e.undo.reason }}
            </div>
          </template>
          <div v-if="plan?.id === e.id" class="undo-plan mp-small" data-testid="undo-plan">
            <p v-if="plan.problems.length" class="mp-error">
              This can’t be undone right now:
              <span v-for="p in plan.problems" :key="p" class="block">{{ p }}</span>
            </p>
            <template v-else>
              <p>Undoing this will:</p>
              <ul>
                <li v-for="line in plan.lines" :key="line">{{ line }}</li>
              </ul>
            </template>
            <div class="mp-row">
              <button class="primary" :disabled="busy || !!plan.problems.length" @click="confirm">
                {{ busy ? 'Undoing…' : 'Undo import' }}
              </button>
              <button :disabled="busy" @click="plan = undefined">Cancel</button>
            </div>
          </div>
          <p v-if="result?.id === e.id" class="mp-small" :class="{ 'mp-error': !result.ok }">
            {{ result.text }}
          </p>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { HistoryData, HistoryRow } from '../src/console'

defineProps<{ events: HistoryRow[]; showMedia?: boolean }>()

const data = useRpc<HistoryData>()
const busy = ref(false)
const plan = ref<{ id: number; lines: string[]; problems: string[] }>()
const result = ref<{ id: number; ok: boolean; text: string }>()

async function review(id: number) {
  busy.value = true
  result.value = undefined
  try {
    plan.value = { id, ...(await data.value.undoPlan(id)) }
  } catch (e) {
    result.value = { id, ok: false, text: e instanceof Error ? e.message : String(e) }
  } finally {
    busy.value = false
  }
}

async function confirm() {
  if (!plan.value) return
  const id = plan.value.id
  busy.value = true
  try {
    const outcome = await data.value.undo(id)
    plan.value = undefined
    result.value = {
      id,
      ok: outcome.ok,
      text: outcome.ok
        ? ['Undone.', ...outcome.warnings].join(' ')
        : `Not undone: ${outcome.reasons.join('; ')}`,
    }
  } catch (e) {
    result.value = { id, ok: false, text: e instanceof Error ? e.message : String(e) }
  } finally {
    busy.value = false
  }
}

const BADGES = {
  grabbed: 'info',
  'download-failed': 'bad',
  imported: 'ok',
  'import-failed': 'bad',
  'import-undone': 'info',
}

const LABELS = {
  grabbed: 'Sent to client',
  'download-failed': 'Download failed',
  imported: 'Imported',
  'import-failed': 'Import failed',
  'import-undone': 'Import undone',
}

function details(e: HistoryRow) {
  const d = e.data as Record<string, string | number | boolean | undefined>
  switch (e.type) {
    case 'grabbed':
      return [d.quality, d.manual && 'by you'].filter(Boolean).join(' · ')
    case 'imported':
      return [
        d.quality,
        d.method,
        typeof d.files === 'number' && d.files > 1 && `${d.files} files`,
        d.replaced && `replaced ${d.replaced}`,
      ]
        .filter(Boolean)
        .join(' · ')
    default:
      return String(d.reason ?? '')
  }
}
</script>

<style scoped>
.undo-plan {
  margin-top: 6px;
}
.undo-plan ul {
  margin: 4px 0 8px 18px;
  padding: 0;
  word-break: break-all;
}
.block {
  display: block;
}
.link {
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.release {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
}
</style>
