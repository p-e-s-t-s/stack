<template>
  <section>
    <div class="mp-head"><h1>Download clients</h1></div>
    <p class="mp-lead">
      Magpie sends each download to the client with the lowest priority for its protocol, in its own
      category, and imports it when it finishes.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'download-client', status, test }" />
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { DownloadsData } from '../src/console'

const data = useRpc<DownloadsData>()

// client ids are `<type>:<entry id>`; the settings list is keyed by entry id
const entryId = (id: string) => id.slice(id.indexOf(':') + 1)

const status = computed(() =>
  Object.fromEntries(
    data.value.clients.map((c) => [
      entryId(c.id),
      {
        ok: true,
        text: 'Running',
        detail: `${c.protocol} · category ${c.category} · priority ${c.priority}`,
      },
    ]),
  ),
)

async function test(id: string) {
  const client = data.value.clients.find((c) => entryId(c.id) === id)
  if (!client) return { ok: false, message: 'not running; check that it is enabled' }
  return data.value.test(client.id)
}
</script>
