<template>
  <section>
    <div class="mp-head"><h1>Statistics</h1></div>
    <p class="mp-lead">
      {{ s.totals.items }} titles, {{ s.totals.files }} files, {{ size(s.totals.bytes) }}.
    </p>

    <h2>By kind</h2>
    <p v-if="!s.kinds.length" class="mp-empty">No media kinds are installed.</p>
    <table v-else class="mp-table" data-testid="kinds">
      <thead>
        <tr>
          <th>Kind</th>
          <th>Titles</th>
          <th>Monitored</th>
          <th>With files</th>
          <th>Files</th>
          <th>Size</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="k in s.kinds" :key="k.kind">
          <td>{{ k.label }}</td>
          <td>{{ k.items }}</td>
          <td>{{ k.monitored }}</td>
          <td>{{ k.withFiles }}</td>
          <td>{{ k.files }}</td>
          <td>{{ size(k.bytes) }}</td>
        </tr>
      </tbody>
    </table>

    <h2>Quality</h2>
    <p v-if="!s.qualities.length" class="mp-empty">No files yet.</p>
    <div v-else class="bars" data-testid="qualities">
      <div v-for="q in s.qualities" :key="q.quality" class="bar">
        <span class="name">{{ q.quality }}</span>
        <span class="track"><span class="fill" :style="{ width: pct(q.files, maxFiles) }" /></span>
        <span class="mp-muted mp-small">{{ q.files }} files · {{ size(q.bytes) }}</span>
      </div>
    </div>

    <h2>Last 30 days</h2>
    <div class="days" data-testid="days">
      <div v-for="d in s.days" :key="d.day" class="day" :title="dayTitle(d)">
        <span class="col grabbed" :style="{ height: pct(d.grabbed, maxDay) }" />
        <span class="col imported" :style="{ height: pct(d.imported, maxDay) }" />
        <span class="col failed" :style="{ height: pct(d.failed, maxDay) }" />
      </div>
    </div>
    <p class="mp-muted mp-small">
      <span class="key grabbed" /> grabbed <span class="key imported" /> imported
      <span class="key failed" /> failed
    </p>
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { DayStats } from '../src'
import type { StatsData } from '../src/console'

const data = useRpc<StatsData>()
const s = computed(() => data.value.stats)

const maxFiles = computed(() => Math.max(1, ...s.value.qualities.map((q) => q.files)))
const maxDay = computed(() =>
  Math.max(1, ...s.value.days.flatMap((d) => [d.grabbed, d.imported, d.failed])),
)
const pct = (n: number, max: number) => `${Math.round((n / max) * 100)}%`
const dayTitle = (d: DayStats) =>
  `${d.day}: ${d.grabbed} grabbed, ${d.imported} imported, ${d.failed} failed`

function size(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024
    i++
  }
  return `${bytes.toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}
</script>

<style scoped>
.bar {
  display: grid;
  grid-template-columns: minmax(6rem, 12rem) 1fr auto;
  gap: 0.75rem;
  align-items: center;
  margin: 0.25rem 0;
}
.track {
  background: var(--mp-border, #8884);
  border-radius: 4px;
  height: 0.75rem;
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--mp-accent, #4f8cff);
}
.days {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 7rem;
}
.day {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 100%;
}
.col {
  flex: 1;
  min-height: 1px;
  border-radius: 2px 2px 0 0;
}
.grabbed,
.key.grabbed {
  background: var(--mp-accent, #4f8cff);
}
.imported,
.key.imported {
  background: #3fa66a;
}
.failed,
.key.failed {
  background: #d9534f;
}
.key {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 2px;
  margin: 0 0.25rem 0 0.75rem;
}
@media (max-width: 600px) {
  .bar {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
</style>
