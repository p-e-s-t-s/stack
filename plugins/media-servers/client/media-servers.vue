<template>
  <section>
    <div class="mp-head"><h1>Media servers</h1></div>
    <p class="mp-lead">
      After an import, Magpie asks each server below to look at the new files, so they show up
      without a full library scan. Test connection never scans; Test scan asks the server to look at
      one folder you name.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'media-server', status, test }" />

    <div v-if="data.servers.length" class="mp-card">
      <h3>Test scan</h3>
      <div class="mp-row">
        <select v-model="serverId">
          <option v-for="s in data.servers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input v-model="path" placeholder="A folder in your library, e.g. /movies/Alien (1979)" />
        <button class="small" :disabled="!path" @click="scan">Test scan</button>
      </div>
      <p v-if="result" class="mp-small" :class="{ 'mp-error': !result.ok }">{{ result.message }}</p>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref, watchEffect } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { MediaServersData } from '../src/console'

const data = useRpc<MediaServersData>()

// server ids are `<type>:<entry id>`; the settings list is keyed by entry id
const entryId = (id: string) => id.slice(id.indexOf(':') + 1)

const status = computed(() =>
  Object.fromEntries(
    data.value.servers.map((s) => [
      entryId(s.id),
      {
        ok: !s.lastError,
        text: s.lastError ? 'Last scan failed' : 'Running',
        detail:
          s.lastError ??
          s.lastSkipped ??
          (s.lastAcceptedAt
            ? `last scan accepted ${new Date(s.lastAcceptedAt).toLocaleString()}`
            : undefined),
      },
    ]),
  ),
)

async function test(id: string) {
  const server = data.value.servers.find((s) => entryId(s.id) === id)
  if (!server) return { ok: false, message: 'not running; check that it is enabled' }
  return data.value.test(server.id)
}

const serverId = ref('')
const path = ref('')
const result = ref<{ ok: boolean; message?: string }>()
watchEffect(() => {
  if (!data.value.servers.some((s) => s.id === serverId.value))
    serverId.value = data.value.servers[0]?.id ?? ''
})
async function scan() {
  result.value = await data.value.testRefresh(serverId.value, path.value)
}
</script>
