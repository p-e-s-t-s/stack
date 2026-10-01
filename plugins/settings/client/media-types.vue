<template>
  <div data-testid="media-types">
    <p class="mp-lead">
      Switch off the kinds of media you don't use. They are hidden and stop searching. Your library
      and files are kept, and switching one back on restores it.
    </p>
    <div v-for="t in data.mediaTypes" :key="t.name" class="mp-row type">
      <label :title="t.blockedBy ? `Needed by ${t.blockedBy}` : undefined">
        <input
          type="checkbox"
          :checked="t.enabled"
          :disabled="busy === t.name || !!t.blockedBy"
          :data-testid="`media-type-${t.name}`"
          @change="toggle(t.name, ($event.target as HTMLInputElement).checked)"
        />
        <strong>{{ t.label }}</strong>
      </label>
      <span class="mp-muted mp-small">{{ t.summary }}</span>
      <span v-if="t.blockedBy" class="mp-muted mp-small">Needed by {{ t.blockedBy }}.</span>
    </div>
    <p v-if="error" class="mp-error" role="alert">{{ error }}</p>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { SettingsData } from '../src/console'

const data = useRpc<SettingsData>()
const busy = ref('')
const error = ref('')

async function toggle(name: string, enabled: boolean) {
  busy.value = name
  error.value = ''
  try {
    await data.value.setMediaType(name, enabled)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.type {
  gap: 0.75rem;
  align-items: baseline;
}
.type label {
  display: inline-flex;
  gap: 0.4rem;
  align-items: center;
}
</style>
