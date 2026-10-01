<template>
  <section>
    <div class="mp-head"><h1>General</h1></div>

    <h2>Your account</h2>
    <p v-if="me" class="mp-lead">
      Logged in as <strong>{{ me.username }}</strong
      >, {{ roleLabel }}.
    </p>

    <h2>Password</h2>
    <form class="mp-card" @submit.prevent="changePassword">
      <div class="mp-field">
        <label for="current">Current password</label>
        <input id="current" v-model="current" type="password" autocomplete="current-password" />
      </div>
      <div class="mp-field">
        <label for="next">New password</label>
        <input id="next" v-model="next" type="password" autocomplete="new-password" />
        <span class="mp-help">At least 8 characters. Your other sessions are logged out.</span>
      </div>
      <div class="mp-row">
        <button class="primary" type="submit" :disabled="!current || !next">Change password</button>
        <span v-if="passwordMessage" :class="passwordOk ? 'mp-muted' : 'mp-error'">
          {{ passwordMessage }}
        </span>
      </div>
    </form>

    <h2>Sessions</h2>
    <p class="mp-lead">Browsers logged in as you.</p>
    <table v-if="me?.sessions.length" class="mp-table">
      <tbody>
        <tr v-for="session in me.sessions" :key="session.id">
          <td>
            <strong>{{ browser(session.userAgent) }}</strong>
            <span v-if="session.current" class="mp-muted"> (this one)</span>
            <div class="mp-muted mp-small">{{ session.address || 'unknown address' }}</div>
          </td>
          <td class="mp-muted mp-small">
            Started {{ new Date(session.createdAt).toLocaleString() }}<br />
            <template v-if="session.lastSeenAt"
              >Last used {{ new Date(session.lastSeenAt).toLocaleString() }}</template
            >
          </td>
          <td class="actions">
            <button v-if="!session.current" class="small danger" @click="revoke(session.id)">
              Log out
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="me && me.sessions.length > 1" class="mp-row more">
      <button class="small" type="button" @click="revokeOthers">Log out everywhere else</button>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { AuthData } from '../src/console'
import type { SessionInfo } from '../src/index'
import { api } from './api'

const data = useRpc<AuthData>()
interface Me {
  username: string
  role: string
  sessions: SessionInfo[]
}
const me = ref<Me>()
const current = ref('')
const next = ref('')
const passwordMessage = ref('')
const passwordOk = ref(false)

const roleLabel = computed(() => data.value.roles.find((r) => r.id === me.value?.role)?.label)

async function load() {
  me.value = await api<Me>('GET', '/account')
}
onMounted(load)

/** "Firefox on Linux" from a user-agent string, as far as it is plain. */
function browser(userAgent: string | null) {
  if (!userAgent) return 'Unknown browser'
  const name = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : ''
  return os ? `${name} on ${os}` : name
}

async function changePassword() {
  try {
    await api('PUT', '/account/password', { current: current.value, next: next.value })
    passwordOk.value = true
    passwordMessage.value = 'Password changed. Other sessions were logged out.'
    current.value = next.value = ''
    await load()
  } catch (error) {
    passwordOk.value = false
    passwordMessage.value = (error as Error).message
  }
}

async function revoke(id: string) {
  await api('DELETE', `/account/sessions/${id}`)
  await load()
}

async function revokeOthers() {
  await api('DELETE', '/account/sessions')
  await load()
}
</script>

<style scoped>
.more {
  margin-top: 12px;
}
</style>
