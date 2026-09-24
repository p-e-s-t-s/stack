<template>
  <section class="ix">
    <h1>Indexers</h1>
    <p class="muted">
      Add Prowlarr's Torznab/Newznab URL for each indexer as a
      <code>@magpiejs/indexer-torznab</code> entry in <code>magpie.yml</code>. Editing them here
      comes with the Settings pages.
    </p>
    <p v-if="!data.indexers.length" class="muted">No indexers configured.</p>
    <table v-else class="mp-card">
      <thead>
        <tr>
          <th>Name</th>
          <th>Protocol</th>
          <th>Used for</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="i in data.indexers" :key="i.id">
          <td>{{ i.name }}</td>
          <td>{{ i.protocol }}</td>
          <td class="muted">
            {{
              [
                i.enableRss && 'RSS',
                i.enableAutomatic && 'automatic',
                i.enableInteractive && 'interactive',
              ]
                .filter(Boolean)
                .join(', ')
            }}
          </td>
          <td>
            <span v-if="i.healthy" class="ok">OK</span>
            <span v-else class="bad" :title="i.lastError ?? ''"
              >Paused until {{ new Date(i.disabledUntil!).toLocaleTimeString() }} —
              {{ i.lastError }}</span
            >
          </td>
          <td>
            <button @click="test(i.id)">Test</button>
            <span v-if="results[i.id]" :class="results[i.id]!.ok ? 'ok' : 'bad'">
              {{ results[i.id]!.ok ? 'Works' : results[i.id]!.message }}</span
            >
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script lang="ts" setup>
import { reactive } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { IndexersData } from '../src/console'

const data = useRpc<IndexersData>()
const results = reactive<Record<string, { ok: boolean; message?: string }>>({})
async function test(id: string) {
  results[id] = await data.value.test(id)
}
</script>

<style scoped>
.muted {
  color: var(--mp-muted);
  font-size: 13px;
}
.ok {
  color: #2ea44f;
}
.bad {
  color: #d33;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--mp-border);
}
button {
  font: inherit;
  color: var(--mp-text);
  background: var(--mp-surface);
  border: 1px solid var(--mp-border);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
}
</style>
