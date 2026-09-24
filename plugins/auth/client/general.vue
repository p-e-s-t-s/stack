<template>
  <section>
    <h1>General</h1>

    <h2>Login</h2>
    <div class="mp-card">
      <p class="muted">
        Logged in as <strong>{{ data.username }}</strong
        >.
      </p>
      <div class="row">
        <input
          v-model="current"
          type="password"
          placeholder="Current password"
          autocomplete="current-password"
        />
        <input
          v-model="next"
          type="password"
          placeholder="New password"
          autocomplete="new-password"
        />
        <button :disabled="!current || !next" @click="changePassword">Change password</button>
      </div>
      <p v-if="passwordMessage" :class="passwordOk ? 'muted' : 'error'">{{ passwordMessage }}</p>
      <form method="post" action="/auth/logout">
        <button type="submit">Log out</button>
      </form>
    </div>

    <h2>API keys</h2>
    <p class="muted">
      For other programs using <code>/api/v1</code>. Send the key in an
      <code>X-Api-Key</code> header.
    </p>
    <div class="mp-card">
      <table>
        <tbody>
          <tr v-for="key in data.apiKeys" :key="key.id">
            <td>{{ key.name }}</td>
            <td class="mono">{{ key.prefix }}…</td>
            <td class="muted">
              {{
                key.lastUsedAt ? `used ${new Date(key.lastUsedAt).toLocaleString()}` : 'never used'
              }}
            </td>
            <td style="width: 80px"><button @click="data.revokeApiKey(key.id)">Revoke</button></td>
          </tr>
          <tr v-if="!data.apiKeys.length">
            <td class="muted">No API keys.</td>
          </tr>
        </tbody>
      </table>
      <div class="row">
        <input v-model="keyName" placeholder="Name, e.g. Prowlarr" style="flex: 1" />
        <button class="primary" @click="createKey">Create key</button>
      </div>
      <p v-if="newKey">
        Copy this key now, it is not shown again: <code class="mono">{{ newKey }}</code>
      </p>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { AuthData } from '../src/console'

const data = useRpc<AuthData>()
const current = ref('')
const next = ref('')
const passwordMessage = ref('')
const passwordOk = ref(false)
const keyName = ref('')
const newKey = ref('')

async function changePassword() {
  try {
    await data.value.changePassword(current.value, next.value)
    passwordOk.value = true
    passwordMessage.value = 'Password changed. Other sessions were logged out.'
    current.value = next.value = ''
  } catch (error) {
    passwordOk.value = false
    passwordMessage.value = (error as Error).message
  }
}

async function createKey() {
  newKey.value = await data.value.createApiKey(keyName.value)
  keyName.value = ''
}
</script>

<style scoped>
.muted {
  color: var(--mp-muted);
  font-size: 13px;
}
.error {
  color: #d33;
}
.mono {
  font-family: ui-monospace, monospace;
}
.row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
  flex-wrap: wrap;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--mp-border);
}
input,
button {
  font: inherit;
  color: var(--mp-text);
  background: var(--mp-surface);
  border: 1px solid var(--mp-border);
  border-radius: 6px;
  padding: 4px 8px;
}
button {
  cursor: pointer;
}
button.primary {
  background: var(--mp-accent);
  color: #fff;
  border-color: transparent;
}
</style>
