<template>
  <section class="dl">
    <h1>Activity</h1>
    <div class="tabs">
      <button :class="{ active: tab === 'queue' }" @click="tab = 'queue'">
        Queue ({{ data.queue.length }})
      </button>
      <button :class="{ active: tab === 'recent' }" @click="tab = 'recent'">Recent</button>
      <button :class="{ active: tab === 'blocklist' }" @click="tab = 'blocklist'">
        Blocklist ({{ data.blocklist.length }})
      </button>
    </div>

    <template v-if="tab === 'queue'">
      <p v-if="!data.queue.length" class="muted">Nothing downloading.</p>
      <table v-else class="mp-card" data-testid="queue">
        <thead>
          <tr>
            <th>Movie</th>
            <th>Quality</th>
            <th>Progress</th>
            <th>State</th>
            <th>Client</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in data.queue" :key="g.id">
            <td>
              {{ g.mediaTitle }}
              <div class="release">{{ g.title }}</div>
            </td>
            <td>{{ g.quality }}</td>
            <td>
              {{ (g.progress * 100).toFixed(1) }}%
              <span class="muted">{{ eta(g.etaSeconds) }}</span>
              <div class="bar"><div :style="{ width: g.progress * 100 + '%' }" /></div>
            </td>
            <td>
              <span class="state" :class="g.state">{{ label(g.state) }}</span>
              <div v-if="g.error" class="error">{{ g.error }}</div>
            </td>
            <td>{{ g.client }}</td>
            <td style="white-space: nowrap">
              <button
                title="Remove from the client"
                @click="data.remove(g.id, { blocklist: false, deleteData: true })"
              >
                Remove
              </button>
              <button
                title="Remove, blocklist and search again"
                @click="data.remove(g.id, { blocklist: true, deleteData: true })"
              >
                Blocklist
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else-if="tab === 'recent'">
      <p v-if="!data.recent.length" class="muted">No finished downloads yet.</p>
      <table v-else class="mp-card">
        <thead>
          <tr>
            <th>Movie</th>
            <th>Quality</th>
            <th>Result</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in data.recent" :key="g.id">
            <td>
              {{ g.mediaTitle }}
              <div class="release">{{ g.title }}</div>
            </td>
            <td>{{ g.quality }}</td>
            <td>
              <span class="state" :class="g.state">{{ label(g.state) }}</span>
              <div v-if="g.error" class="error">{{ g.error }}</div>
            </td>
            <td class="muted">{{ new Date(g.updatedAt).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <p v-if="!data.blocklist.length" class="muted">Nothing blocklisted.</p>
      <table v-else class="mp-card">
        <thead>
          <tr>
            <th>Movie</th>
            <th>Release</th>
            <th>Reason</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in data.blocklist" :key="b.id">
            <td>{{ b.mediaTitle }}</td>
            <td class="release">{{ b.title }}</td>
            <td>{{ b.reason }}</td>
            <td><button @click="data.unblock(b.id)">Remove</button></td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { DownloadsData } from '../src/console'

const data = useRpc<DownloadsData>()
const tab = ref<'queue' | 'recent' | 'blocklist'>('queue')

const LABELS: Record<string, string> = {
  grabbed: 'Sent to client',
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  stalled: 'Stalled',
  import_pending: 'Waiting to import',
  importing: 'Importing',
  imported: 'Imported',
  failed: 'Failed',
  import_failed: 'Import failed',
  removed: 'Removed',
}
const label = (s: string) => LABELS[s] ?? s
const eta = (s: number | null) =>
  !s || s < 0 || s > 8_640_000
    ? ''
    : s < 3600
      ? `${Math.ceil(s / 60)} min left`
      : `${(s / 3600).toFixed(1)} h left`
</script>
