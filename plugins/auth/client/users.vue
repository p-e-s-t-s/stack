<template>
  <section>
    <div class="mp-head"><h1>Users</h1></div>
    <p class="mp-lead">
      Everyone who can log in to Magpie, and what they may do. The last active administrator can't
      be removed or switched off.
    </p>

    <table class="mp-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Role</th>
          <th>Last login</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id" :class="{ off: user.disabled }">
          <td>
            <strong>{{ user.username }}</strong>
            <span v-if="user.disabled" class="mp-muted"> (switched off)</span>
          </td>
          <td>
            <select
              :value="user.role"
              @change="setRole(user, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="role in data.roles" :key="role.id" :value="role.id">
                {{ role.label }}
              </option>
            </select>
          </td>
          <td class="mp-muted mp-small">
            {{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never' }}
          </td>
          <td class="actions">
            <button class="small" @click="resetting = resetting === user.id ? 0 : user.id">
              Password
            </button>
            <button
              class="small"
              @click="run(() => data.updateUser(user.id, { disabled: !user.disabled }))"
            >
              {{ user.disabled ? 'Switch on' : 'Switch off' }}
            </button>
            <button class="small danger" @click="remove(user)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
    <form v-if="resetting" class="mp-row gap" @submit.prevent="reset">
      <input
        v-model="resetPassword"
        type="password"
        autocomplete="new-password"
        :placeholder="`New password for ${resettingName}`"
        class="name"
      />
      <button class="primary" type="submit" :disabled="!resetPassword">Set password</button>
      <span class="mp-muted mp-small">Logs them out everywhere.</span>
    </form>

    <h2>Add a user</h2>
    <form class="mp-card" @submit.prevent="add">
      <div class="mp-field">
        <label for="new-name">Username</label>
        <input id="new-name" v-model="newName" autocomplete="off" />
      </div>
      <div class="mp-field">
        <label for="new-password">Password</label>
        <input
          id="new-password"
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
        />
        <span class="mp-help">At least 8 characters. They can change it under General.</span>
      </div>
      <div class="mp-field">
        <label for="new-role">Role</label>
        <select id="new-role" v-model="newRole">
          <option v-for="role in data.roles" :key="role.id" :value="role.id">
            {{ role.label }}
          </option>
        </select>
        <span class="mp-help">{{ describe(newRole) }}</span>
      </div>
      <div class="mp-row">
        <button class="primary" type="submit" :disabled="!newName || !newPassword">Add user</button>
      </div>
    </form>

    <p v-if="error" class="mp-error" role="alert">{{ error }}</p>

    <h2>Roles</h2>
    <table class="mp-table">
      <tbody>
        <tr v-for="role in data.roles" :key="role.id">
          <td>
            <strong>{{ role.label }}</strong>
          </td>
          <td class="mp-muted">{{ role.description }}</td>
        </tr>
      </tbody>
    </table>

    <h2>API keys</h2>
    <p class="mp-lead">
      For other programs using Magpie's API at <code>/api/v1</code>. They send the key in an
      <code>X-Api-Key</code> header. A key can be a viewer or a manager, and never outranks the user
      who made it.
    </p>
    <table v-if="keys.length" class="mp-table">
      <tbody>
        <tr v-for="key in keys" :key="key.id">
          <td>
            <strong>{{ key.name }}</strong>
            <span class="mono mp-muted prefix">{{ key.prefix }}…</span>
          </td>
          <td>{{ roleLabel(key.role) }}</td>
          <td class="mp-muted mp-small">
            {{ key.owner ? `Made by ${key.owner}` : 'Made before users had roles' }}<br />
            {{
              key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleString()}` : 'Never used'
            }}
          </td>
          <td class="actions">
            <button class="small danger" @click="run(() => data.revokeApiKey(key.id))">
              Revoke
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <form class="mp-row gap add" @submit.prevent="createKey">
      <input v-model="keyName" placeholder="What it's for, e.g. Home Assistant" class="name" />
      <select v-model="keyRole">
        <option v-for="role in data.roles.filter((r) => r.key)" :key="role.id" :value="role.id">
          {{ role.label }}
        </option>
      </select>
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
import { computed, onMounted, ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { ApiKeyInfo, UserInfo } from '../src/index'
import type { AuthData } from '../src/console'

const data = useRpc<AuthData>()
const users = ref<UserInfo[]>([])
const keys = ref<ApiKeyInfo[]>([])
const error = ref('')

const newName = ref('')
const newPassword = ref('')
const newRole = ref<UserInfo['role']>('viewer')
const resetting = ref(0)
const resetPassword = ref('')
const resettingName = computed(() => users.value.find((u) => u.id === resetting.value)?.username)

const keyName = ref('')
const keyRole = ref<UserInfo['role']>('viewer')
const newKey = ref('')
const copied = ref(false)

const roleLabel = (id: string) => data.value.roles.find((r) => r.id === id)?.label ?? id
const describe = (id: string) => data.value.roles.find((r) => r.id === id)?.description

async function load() {
  ;[users.value, keys.value] = await Promise.all([data.value.users(), data.value.apiKeys()])
}
onMounted(load)

/** Runs a change, shows its error if it fails, and reloads. */
async function run(change: () => Promise<unknown>) {
  error.value = ''
  try {
    await change()
  } catch (e) {
    error.value = (e as Error).message
  }
  await load()
}

async function add() {
  await run(async () => {
    await data.value.createUser(newName.value, newPassword.value, newRole.value)
    newName.value = newPassword.value = ''
  })
}

function setRole(user: UserInfo, role: string) {
  return run(() => data.value.updateUser(user.id, { role: role as UserInfo['role'] }))
}

async function reset() {
  await run(async () => {
    await data.value.resetPassword(resetting.value, resetPassword.value)
    resetting.value = 0
    resetPassword.value = ''
  })
}

function remove(user: UserInfo) {
  if (!confirm(`Delete ${user.username}? Their sessions and API keys go with them.`)) return
  return run(() => data.value.deleteUser(user.id))
}

async function createKey() {
  copied.value = false
  await run(async () => {
    newKey.value = await data.value.createApiKey(keyName.value, keyRole.value)
    keyName.value = ''
  })
}

async function copy() {
  try {
    await navigator.clipboard.writeText(newKey.value)
    copied.value = true
  } catch {
    // the clipboard needs https or localhost; the key can still be selected by hand
  }
}
</script>

<style scoped>
.off {
  opacity: 0.6;
}
.gap {
  gap: 8px;
  margin-top: 12px;
}
.name {
  flex: 1;
  max-width: 360px;
}
.add {
  margin-top: 12px;
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
