<template>
  <section>
    <h1>System</h1>

    <div class="mp-card">
      <strong>Uptime</strong>
      <span data-testid="uptime" style="margin-left: 12px">{{ uptime }}</span>
    </div>

    <queue-widget />
    <button data-testid="run-test-job" @click="data.runTestJob()">Run a test job</button>

    <div class="mp-card" style="margin-top: 16px">
      <strong>Database</strong>
      <table style="width: 100%; margin-top: 8px">
        <thead>
          <tr>
            <th align="left">Plugin namespace</th>
            <th align="left">Loaded</th>
            <th align="left">Migrations</th>
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
    </div>

    <div class="mp-card">
      <strong>Job queue settings</strong>
      <p style="color: var(--mp-muted)">Saved to magpie.yml and applied without a restart.</p>
      <k-form v-model="draft" :schema="schema" :initial="data.jobsConfig" />
      <button data-testid="save-jobs-config" @click="save">Save</button>
      <span v-if="saved" style="margin-left: 8px">Saved.</span>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import Schema from 'schemastery'
import type { SystemData } from '../src'
import QueueWidget from './queue-widget.vue'

const data = useRpc<SystemData>()
const schema = computed(() => new Schema(data.value.jobsSchema as any))
const draft = ref(JSON.parse(JSON.stringify(data.value.jobsConfig)))
const saved = ref(false)

const uptime = computed(() => {
  const s = Math.floor((data.value.now - data.value.startedAt) / 1000)
  return `${Math.floor(s / 60)}m ${s % 60}s`
})

async function save() {
  await data.value.saveJobsConfig(draft.value)
  saved.value = true
}
</script>
