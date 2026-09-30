<template>
  <section>
    <div class="mp-head"><h1>Notifications</h1></div>
    <p class="mp-lead">
      Magpie sends a message to each destination below when something it is set to tell you about
      happens. A failed message is retried a few times.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'notifier', status, test }" />

    <h2>Recent activity</h2>
    <table v-if="data.log.length" class="mp-table">
      <tbody>
        <tr v-for="row in data.log" :key="row.id">
          <td>
            {{ row.title }}
            <div class="mp-muted mp-small">
              {{ row.notifierName }} · {{ new Date(row.createdAt).toLocaleString() }}
            </div>
            <div v-if="row.error" class="mp-small mp-error">{{ row.error }}</div>
          </td>
          <td class="state">
            <span class="mp-badge" :class="badge(row.status)">{{ row.status }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="mp-card mp-muted">Nothing sent yet.</p>
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { NotificationsData } from '../src/console'

const data = useRpc<NotificationsData>()

// destination ids are `<type>:<entry id>`; the settings list is keyed by entry id
const entryId = (id: string) => id.slice(id.indexOf(':') + 1)

const status = computed(() =>
  Object.fromEntries(
    data.value.destinations.map((d) => [entryId(d.id), { ok: true, text: 'Running' }]),
  ),
)

async function test(id: string) {
  const destination = data.value.destinations.find((d) => entryId(d.id) === id)
  if (!destination) return { ok: false, message: 'not running; check that it is enabled' }
  return data.value.test(destination.id)
}

const badge = (state: string) =>
  state === 'sent' ? 'ok' : state === 'failed' || state === 'cancelled' ? 'bad' : ''
</script>
