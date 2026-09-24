<template>
  <section>
    <div class="mp-head"><h1>Status</h1></div>
    <p class="mp-lead">Running for {{ uptime }}.</p>

    <h2>Background jobs</h2>
    <div class="stats">
      <div v-for="s in stats" :key="s.key" class="mp-card stat">
        <div class="value" :class="{ bad: s.key === 'failed' && s.value }">{{ s.value }}</div>
        <div class="mp-muted mp-small">{{ s.label }}</div>
      </div>
    </div>
    <template v-if="data.failed.length">
      <h3>Recent failures</h3>
      <table class="mp-table">
        <tbody>
          <tr v-for="j in data.failed" :key="j.id">
            <td class="mono">{{ j.type }}</td>
            <td class="mp-error">{{ j.error }}</td>
            <td class="mp-muted mp-small" style="white-space: nowrap">
              {{ new Date(j.at).toLocaleString() }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <details class="details">
      <summary>Database details</summary>
      <table class="mp-table">
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Loaded</th>
            <th>Migrations applied</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ns in data.namespaces" :key="ns.namespace">
            <td>{{ ns.namespace }}</td>
            <td>{{ ns.active ? 'yes' : 'no' }}</td>
            <td>{{ ns.migrations }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { SystemData } from '../src'

const data = useRpc<SystemData>()

const uptime = computed(() => {
  const m = Math.floor((data.value.now - data.value.startedAt) / 60_000)
  if (m < 1) return 'less than a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`
})

const stats = computed(() => [
  { key: 'running', label: 'Running', value: data.value.jobs.running ?? 0 },
  { key: 'pending', label: 'Waiting', value: data.value.jobs.pending ?? 0 },
  { key: 'done', label: 'Finished', value: data.value.jobs.done ?? 0 },
  { key: 'failed', label: 'Failed', value: data.value.jobs.failed ?? 0 },
])
</script>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.stat {
  margin: 0;
}
.value {
  font-size: 22px;
  font-weight: 600;
}
.value.bad {
  color: var(--mp-bad);
}
.details {
  margin-top: 28px;
}
.details summary {
  cursor: pointer;
  color: var(--mp-muted);
  margin-bottom: 10px;
}
</style>
