<template>
  <section class="dl">
    <div class="mp-head"><h1>Activity</h1></div>
    <div class="mp-tabs">
      <button :class="{ active: tab === 'queue' }" @click="tab = 'queue'">
        Downloading ({{ queue.length }})
      </button>
      <button :class="{ active: tab === 'blocklist' }" @click="tab = 'blocklist'">
        Blocklist ({{ data.blocklist.length }})
      </button>
    </div>

    <template v-if="tab === 'queue'">
      <p v-if="!queue.length" class="mp-empty">Nothing is downloading.</p>
      <table v-else class="mp-table" data-testid="queue">
        <thead>
          <tr>
            <th>Movie</th>
            <th>Quality</th>
            <th style="width: 200px">Progress</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in queue" :key="g.id">
            <td>
              <strong>{{ g.mediaTitle }}</strong>
              <div class="release">{{ g.title }}</div>
            </td>
            <td>{{ g.quality }}</td>
            <td>
              <div class="mp-row progress-head">
                <span class="mp-badge" :class="badge(g.state)">{{ label(g.state) }}</span>
                <span class="mp-muted mp-small">
                  {{ g.state === 'downloading' ? `${Math.floor(g.progress * 100)}%` : '' }}
                  {{ eta(g.etaSeconds) }}
                </span>
              </div>
              <div v-if="g.state === 'downloading'" class="mp-progress">
                <div :style="{ width: g.progress * 100 + '%' }" />
              </div>
              <div v-if="g.error" class="mp-error mp-small">{{ g.error }}</div>
              <div class="mp-muted mp-small">{{ g.client }}</div>
            </td>
            <td class="actions">
              <button
                class="small"
                title="Remove from the download client"
                @click="data.remove(g.id, { blocklist: false, deleteData: true })"
              >
                Remove
              </button>
              <button
                class="small"
                title="Remove, never download this release again, and look for another"
                @click="data.remove(g.id, { blocklist: true, deleteData: true })"
              >
                Try another
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="mp-muted mp-small hint">
        Finished and failed downloads are listed in
        <a href="/history" @click.prevent="router.push('/history')">History</a>.
      </p>
    </template>

    <template v-else>
      <p class="mp-lead">Releases Magpie will never download again, usually because they failed.</p>
      <p v-if="!data.blocklist.length" class="mp-empty">Nothing blocklisted.</p>
      <table v-else class="mp-table">
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
            <td class="actions">
              <button class="small" @click="data.unblock(b.id)">Allow again</button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { DownloadsData } from '../src/console'

const data = useRpc<DownloadsData>()
const router = useRouter()
const tab = ref<'queue' | 'blocklist'>('queue')
// downloads that could not be imported stay here until they are removed
const queue = computed(() => [
  ...data.value.queue,
  ...data.value.recent.filter((g) => g.state === 'import_failed'),
])
const badge = (state: string) =>
  state === 'import_failed' || state === 'failed'
    ? 'bad'
    : state === 'stalled' || state === 'paused'
      ? 'warn'
      : 'info'

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
