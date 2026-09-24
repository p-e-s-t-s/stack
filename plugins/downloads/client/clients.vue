<template>
  <section class="dl">
    <h1>Download clients</h1>
    <p class="muted">
      Magpie sends downloads to the client with the lowest priority for their protocol, in its own
      category.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'download-client' }" />
    <h2 v-if="data.clients.length">Status</h2>
    <table v-if="data.clients.length" class="mp-card">
      <thead>
        <tr>
          <th>Name</th>
          <th>Protocol</th>
          <th>Category</th>
          <th>Priority</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in data.clients" :key="c.id">
          <td>{{ c.name }}</td>
          <td>{{ c.protocol }}</td>
          <td>{{ c.category }}</td>
          <td>{{ c.priority }}</td>
          <td>
            <button @click="test(c.id)">Test</button>
            <span v-if="results[c.id]" :class="results[c.id]!.ok ? 'ok' : 'error'">
              {{
                results[c.id]!.ok ? (results[c.id]!.message ?? 'Works') : results[c.id]!.message
              }}</span
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
import type { DownloadsData } from '../src/console'

const data = useRpc<DownloadsData>()
const results = reactive<Record<string, { ok: boolean; message?: string }>>({})
async function test(id: string) {
  results[id] = await data.value.test(id)
}
</script>
