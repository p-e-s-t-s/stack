<template>
  <section>
    <div class="mp-head"><h1>Import lists</h1></div>
    <p class="mp-lead">
      Magpie checks each list below on a schedule and adds titles it does not already have. Lists
      are read only: nothing is ever removed from your library or written back to the source.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'import-list', status, test }" />

    <h2>Lists</h2>
    <table v-if="data.lists.length" class="mp-table">
      <tbody>
        <tr v-for="list in data.lists" :key="list.id">
          <td>
            {{ list.name }}
            <div class="mp-muted mp-small">
              <template v-if="list.status?.lastSyncedAt">
                Last sync {{ new Date(list.status.lastSyncedAt).toLocaleString() }}: added
                {{ list.status.added }}, already in library {{ list.status.existing }}, excluded
                {{ list.status.excluded }}, not matched {{ list.status.unmatched }}
              </template>
              <template v-else>Not synced yet</template>
            </div>
            <div v-if="list.status?.lastError" class="mp-small mp-error">
              {{ list.status.lastError }}
            </div>
          </td>
          <td class="actions">
            <button class="small" @click="data.sync(list.id)">Sync now</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="mp-card mp-muted">No list is running.</p>

    <h2>Not matched</h2>
    <p class="mp-muted mp-small">
      Titles without a TMDB match are never added by guessing. Add them by hand from Movies or
      Series.
    </p>
    <table v-if="data.unmatched.length" class="mp-table">
      <tbody>
        <tr v-for="row in data.unmatched" :key="row.listId + row.key">
          <td>
            {{ row.title }}<span v-if="row.year"> ({{ row.year }})</span>
            <div class="mp-muted mp-small">{{ row.kind }}</div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="mp-card mp-muted">Everything on your lists matched.</p>

    <h2>Never add again</h2>
    <p class="mp-muted mp-small">
      Deleting a title that a list added puts it here, so the list does not bring it back.
    </p>
    <table v-if="data.exclusions.length" class="mp-table">
      <tbody>
        <tr v-for="row in data.exclusions" :key="row.key">
          <td>
            {{ row.title }}
            <div class="mp-muted mp-small">{{ row.kind }}</div>
          </td>
          <td class="actions">
            <button class="small" @click="data.unexclude(row.key)">Allow again</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="mp-card mp-muted">Nothing excluded.</p>
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { ImportListsData } from '../src/console'

const data = useRpc<ImportListsData>()

// list ids are `<type>:<entry id>`; the settings list is keyed by entry id
const entryId = (id: string) => id.slice(id.indexOf(':') + 1)

const status = computed(() =>
  Object.fromEntries(data.value.lists.map((l) => [entryId(l.id), { ok: true, text: 'Running' }])),
)

async function test(id: string) {
  const list = data.value.lists.find((l) => entryId(l.id) === id)
  if (!list) return { ok: false, message: 'not running; check that it is enabled' }
  return data.value.test(list.id)
}
</script>
