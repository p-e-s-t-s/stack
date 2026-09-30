<template>
  <section>
    <div class="mp-head">
      <h1>Backups</h1>
      <button
        class="primary"
        :disabled="busy || data.unavailable"
        data-testid="create"
        @click="create"
      >
        Back up now
      </button>
    </div>
    <p class="mp-lead">
      A backup holds the database (your library, history and settings made in the console) and
      <code>magpie.yml</code>. It does not hold your media files. Backups contain API keys and
      passwords in plain text, so keep them somewhere private.
    </p>

    <p v-if="data.unavailable" class="mp-error">
      The database is in memory; there is nothing to back up.
    </p>
    <p v-if="data.error" class="mp-error" data-testid="error">
      The last backup failed: {{ data.error }}
    </p>
    <div v-if="data.staged" class="mp-card" data-testid="staged">
      <strong>Restore of {{ data.staged.from }} is ready.</strong>
      <p class="mp-small">
        Restart Magpie to finish. The current database is kept as a snapshot in the backup folder
        first<template v-if="data.staged.config"
          >, and the current <code>magpie.yml</code> as
          <code>magpie.yml.before-restore</code></template
        >.
      </p>
      <button :disabled="busy" @click="run(() => data.cancelRestore())">Cancel restore</button>
    </div>

    <form class="mp-card" @submit.prevent="save">
      <label class="mp-row">
        <input v-model="draft.enabled" type="checkbox" data-testid="enabled" /> Back up
        automatically
      </label>
      <div class="mp-row">
        <label class="mp-field">
          Every (hours)
          <input
            v-model.number="draft.intervalHours"
            type="number"
            min="1"
            max="720"
            data-testid="interval"
          />
        </label>
        <label class="mp-field">
          Keep the newest
          <input
            v-model.number="draft.retention"
            type="number"
            min="1"
            max="365"
            data-testid="retention"
          />
        </label>
      </div>
      <label class="mp-row">
        <input v-model="draft.includeConfig" type="checkbox" data-testid="include-config" /> Include
        <code>magpie.yml</code>
      </label>
      <div class="mp-row"><button class="primary" :disabled="busy">Save</button></div>
    </form>

    <table class="mp-table" data-testid="backups">
      <thead>
        <tr>
          <th>Made</th>
          <th>Size</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in data.backups" :key="b.name">
          <td>
            {{ new Date(b.createdAt).toLocaleString() }}
            <span class="mp-muted mp-small">
              · {{ b.reason === 'manual' ? 'manual' : 'scheduled' }}</span
            >
          </td>
          <td>{{ fileSize(b.size) }}</td>
          <td class="actions">
            <a :href="`/api/v1/backups/${b.name}`" download>Download</a>
            <button :disabled="busy" :data-testid="`restore-${b.name}`" @click="restore(b.name)">
              Restore
            </button>
            <button :disabled="busy" @click="remove(b.name)">Delete</button>
          </td>
        </tr>
        <tr v-if="!data.backups.length">
          <td colspan="3" class="mp-muted">No backups yet.</td>
        </tr>
      </tbody>
    </table>
    <p v-if="message" :class="bad ? 'mp-error' : 'mp-muted'">{{ message }}</p>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import { fileSize } from '@magpiejs/console-kit'
import type { BackupData } from '../src/console'

const data = useRpc<BackupData>()
const draft = ref({ ...data.value.settings })
const busy = ref(false)
const message = ref('')
const bad = ref(false)

async function run(fn: () => Promise<unknown>, done = '') {
  busy.value = true
  bad.value = false
  message.value = ''
  try {
    await fn()
    message.value = done
  } catch (error) {
    message.value = String(error)
    bad.value = true
  } finally {
    busy.value = false
  }
}

const save = () => run(() => data.value.save({ ...draft.value }), 'Saved')
const create = () => run(() => data.value.create(), 'Backup made')
const remove = (name: string) => {
  if (confirm('Delete this backup?')) return run(() => data.value.remove(name))
}
function restore(name: string) {
  if (!confirm('Replace the database with this backup when Magpie next starts?')) return
  const config = confirm(
    'Also replace magpie.yml (plugins and their settings) with the one in the backup?',
  )
  return run(() => data.value.restore(name, config))
}
</script>

<style scoped>
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}
</style>
