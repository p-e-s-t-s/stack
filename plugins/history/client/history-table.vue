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
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script lang="ts" setup>
import type { HistoryRow } from '../src/console'

defineProps<{ events: HistoryRow[]; showMedia?: boolean }>()

const BADGES = {
  grabbed: 'info',
  'download-failed': 'bad',
  imported: 'ok',
  'import-failed': 'bad',
}

const LABELS = {
  grabbed: 'Sent to client',
  'download-failed': 'Download failed',
  imported: 'Imported',
  'import-failed': 'Import failed',
}

function details(e: HistoryRow) {
  const d = e.data as Record<string, string | boolean | undefined>
  switch (e.type) {
    case 'grabbed':
      return [d.quality, d.manual && 'by you'].filter(Boolean).join(' · ')
    case 'imported':
      return [d.quality, d.method, d.replaced && `replaced ${d.replaced}`]
        .filter(Boolean)
        .join(' · ')
    default:
      return String(d.reason ?? '')
  }
}
</script>

<style scoped>
.release {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
}
</style>
