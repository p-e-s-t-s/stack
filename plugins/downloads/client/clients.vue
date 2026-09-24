<template>
  <section class="dl">
    <h1>Download clients</h1>
    <p class="muted">
      Add qBittorrent as a <code>@magpiejs/downloader-qbittorrent</code> entry in
      <code>magpie.yml</code>. Editing clients here comes with the Settings pages.
    </p>
    <p v-if="!data.clients.length" class="muted">No download clients configured.</p>
    <table v-else class="mp-card">
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
