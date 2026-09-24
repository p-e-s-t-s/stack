<template>
  <section>
    <div class="mp-head"><h1>Indexers</h1></div>
    <p class="mp-lead">
      Where Magpie searches for releases. For Prowlarr, copy each indexer's Torznab URL (like
      <code>http://prowlarr:9696/1/api</code>) and use Prowlarr's API key.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'indexer', status, test }" />
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { IndexersData } from '../src/console'

const data = useRpc<IndexersData>()

// indexer ids are `<type>:<entry id>`; the settings list is keyed by entry id
const entryId = (id: string) => id.slice(id.indexOf(':') + 1)

const status = computed(() =>
  Object.fromEntries(
    data.value.indexers.map((i) => [
      entryId(i.id),
      {
        ok: i.healthy,
        text: i.healthy
          ? 'Working'
          : `Paused until ${new Date(i.disabledUntil!).toLocaleTimeString()}`,
        detail: i.healthy
          ? [
              i.enableRss && 'RSS',
              i.enableAutomatic && 'automatic',
              i.enableInteractive && 'manual search',
            ]
              .filter(Boolean)
              .join(', ')
          : (i.lastError ?? undefined),
      },
    ]),
  ),
)

async function test(id: string) {
  const indexer = data.value.indexers.find((i) => entryId(i.id) === id)
  if (!indexer) return { ok: false, message: 'not running; check that it is enabled' }
  return data.value.test(indexer.id)
}
</script>
