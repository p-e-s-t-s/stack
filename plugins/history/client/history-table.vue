<template>
  <table class="mp-card hist">
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
        <td class="muted" style="white-space: nowrap">
          {{ new Date(e.createdAt).toLocaleString() }}
        </td>
        <td v-if="showMedia">{{ e.mediaTitle }}</td>
        <td>
          <span class="type" :class="e.type">{{ LABELS[e.type] }}</span>
        </td>
        <td>
          <div class="release">{{ e.title }}</div>
          <div class="muted">{{ details(e) }}</div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script lang="ts" setup>
import type { HistoryRow } from '../src/console'

defineProps<{ events: HistoryRow[]; showMedia?: boolean }>()

const LABELS = {
  grabbed: 'Grabbed',
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
.hist {
  width: 100%;
  border-collapse: collapse;
}
.hist th,
.hist td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--mp-border);
  font-size: 14px;
  vertical-align: top;
}
.release {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
}
.muted {
  color: var(--mp-muted);
  font-size: 12px;
}
.type {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--mp-border);
  white-space: nowrap;
}
.type.imported {
  color: #2ea44f;
  border-color: #2ea44f55;
}
.type.download-failed,
.type.import-failed {
  color: #d33;
  border-color: #d3333355;
}
</style>
