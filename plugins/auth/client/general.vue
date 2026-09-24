<template>
  <section>
    <div class="mp-head"><h1>General</h1></div>

    <h2>Password</h2>
    <form class="mp-card" @submit.prevent="changePassword">
      <p class="mp-muted" style="margin-top: 0">Logged in as {{ data.username }}.</p>
      <div class="mp-field">
        <label for="current">Current password</label>
        <input id="current" v-model="current" type="password" autocomplete="current-password" />
      </div>
      <div class="mp-field">
        <label for="next">New password</label>
        <input id="next" v-model="next" type="password" autocomplete="new-password" />
        <span class="mp-help">At least 8 characters. Other devices are logged out.</span>
      </div>
      <div class="mp-row">
        <button class="primary" type="submit" :disabled="!current || !next">Change password</button>
        <span v-if="passwordMessage" :class="passwordOk ? 'mp-muted' : 'mp-error'">
          {{ passwordMessage }}
        </span>
      </div>
    </form>

    <h2>API keys</h2>
    <p class="mp-lead">
      For other programs using Magpie's API at <code>/api/v1</code>. They send the key in an
      <code>X-Api-Key</code> header.
    </p>
    <table v-if="data.apiKeys.length" class="mp-table">
      <tbody>
        <tr v-for="key in data.apiKeys" :key="key.id">
          <td>
            <strong>{{ key.name }}</strong>
            <span class="mono mp-muted prefix">{{ key.prefix }}…</span>
          </td>
          <td class="mp-muted mp-small">
            {{
              key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleString()}` : 'Never used'
            }}
          </td>
          <td class="actions">
            <button class="small danger" @click="data.revokeApiKey(key.id)">Revoke</button>
          </td>
        </tr>
      </tbody>
    </table>
    <form class="mp-row add" @submit.prevent="createKey">
      <input v-model="keyName" placeholder="What it's for, e.g. Home Assistant" class="name" />
      <button class="primary" type="submit">Create key</button>
    </form>
    <div v-if="newKey" class="mp-card new-key">
      Copy this key now; it won't be shown again.
      <div class="mp-row">
        <code class="key">{{ newKey }}</code>
        <button class="small" type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
      </div>
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
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(newKey.value)
    copied.value = true
  } catch {
    // the clipboard needs https or localhost; the key can still be selected by hand
  }
}

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
  copied.value = false
  newKey.value = await data.value.createApiKey(keyName.value)
  keyName.value = ''
}
</script>

<style scoped>
.add {
  margin-top: 12px;
}
.name {
  flex: 1;
  max-width: 360px;
}
.new-key {
  margin-top: 12px;
  background: var(--mp-warn-soft);
  border-color: transparent;
}
.prefix {
  margin-left: 8px;
}
.key {
  font-size: 14px;
  user-select: all;
}
</style>
