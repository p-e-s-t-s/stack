<template>
  <section>
    <div class="mp-head">
      <h1>Health</h1>
      <button :disabled="busy" data-testid="run" @click="run">Check now</button>
    </div>
    <p class="mp-lead" data-testid="summary">
      {{ SUMMARY[data.level] }} Everything is checked again every {{ data.intervalMinutes }}
      minutes.
    </p>

    <div
      v-for="c in data.checks"
      :key="c.name"
      class="mp-card check"
      :data-testid="`check-${c.name}`"
    >
      <div class="mp-row">
        <span class="mp-badge" :class="BADGE[c.level]">{{ LABEL[c.level] }}</span>
        <strong>{{ c.label }}</strong>
        <NavLink v-if="c.link && c.level !== 'ok'" :to="c.link" class="mp-small">Fix</NavLink>
      </div>
      <div>{{ c.message }}</div>
      <ul v-if="c.details?.length" class="mp-small details">
        <li v-for="d in c.details" :key="d">{{ d }}</li>
      </ul>
      <div class="mp-muted mp-small">
        {{ c.description }}
        <template v-if="c.checkedAt">
          · checked {{ new Date(c.checkedAt).toLocaleTimeString() }}</template
        >
      </div>
    </div>
    <p v-if="!data.checks.length" class="mp-muted">Nothing registers a health check yet.</p>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import NavLink from '@magpiejs/console-kit/NavLink.vue'
import type { HealthData } from '../src/console'

const data = useRpc<HealthData>()
const busy = ref(false)

const BADGE = { ok: 'ok', warning: 'warn', error: 'bad', unknown: 'info' } as const
const LABEL = { ok: 'OK', warning: 'Warning', error: 'Problem', unknown: 'Not checked' } as const
const SUMMARY = {
  ok: 'All checks pass.',
  warning: 'Something needs attention.',
  error: 'Something is broken.',
  unknown: 'Waiting for the first check.',
} as const

async function run() {
  busy.value = true
  try {
    await data.value.run()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.check {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.details {
  margin: 0;
  padding-left: 18px;
}
</style>
