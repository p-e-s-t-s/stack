<template>
  <section class="ap">
    <div class="mp-head"><h1>Appearance</h1></div>
    <p class="mp-lead">
      Choose how Magpie looks for you. Themes are plugins; ones you have not chosen can still be the
      default for everyone who has not picked.
    </p>
    <p v-if="error" class="mp-error" role="alert">{{ error }}</p>
    <p v-if="safeMode" class="mp-muted" role="status">
      This tab is showing the built-in look (<code>?theme=default</code>). Your choice below still
      applies in other tabs.
    </p>
    <div v-if="state" class="ap-list">
      <article
        v-for="theme in data.themes"
        :key="theme.id"
        class="mp-card ap-card"
        :class="{ 'is-current': theme.id === current }"
        :data-testid="`theme-${theme.id}`"
      >
        <div class="ap-swatch" aria-hidden="true">
          <i v-for="(colour, i) in theme.swatch ?? []" :key="i" :style="{ background: colour }" />
        </div>
        <h2>{{ theme.name }}</h2>
        <p v-if="theme.description" class="mp-muted">{{ theme.description }}</p>
        <p class="ap-tags">
          <span v-if="theme.id === current" class="mp-badge ok">In use</span>
          <span v-if="theme.id === state.default" class="mp-badge">Default for everyone</span>
          <span v-if="!theme.available" class="mp-badge warn">
            Needs {{ theme.extends }} installed
          </span>
        </p>
        <div class="mp-row">
          <button
            class="primary small"
            :disabled="busy || !theme.available || theme.id === chosen"
            @click="save('/themes/me', theme.id === 'default' ? null : theme.id)"
          >
            Use for me
          </button>
          <button
            class="small"
            :disabled="busy || !theme.available || theme.id === state.default"
            @click="save('/themes/default', theme.id === 'default' ? null : theme.id)"
          >
            Use for everyone
          </button>
        </div>
      </article>
    </div>
    <p v-if="state && state.mine" class="mp-small">
      <button class="link" :disabled="busy" @click="save('/themes/me', null)">
        Follow the default instead
      </button>
    </p>
  </section>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useContext, useRpc } from '@cordisjs/client'
import type { ThemesData } from '../src/console'
import { choose, fetchThemes, type ThemesState } from './sync'

const ctx = useContext()
const data = useRpc<ThemesData & { version: number }>()
const state = ref<ThemesState>()
const error = ref('')
const busy = ref(false)
const safeMode = ctx.client.themes.safeMode

/** The theme in use here: the front of the chain. */
const current = computed(() => ctx.client.themes.chain.value[0] ?? 'default')
/** What this user chose, as a theme id (the default when following it). */
const chosen = computed(() => state.value?.mine ?? 'default')

async function refresh() {
  try {
    state.value = await fetchThemes()
    error.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function save(path: '/themes/me' | '/themes/default', id: string | null) {
  busy.value = true
  error.value = ''
  try {
    ctx.client.themes.apply(await choose(path, id))
    await refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
watch(() => data.value.version, refresh)
</script>

<style scoped>
.ap-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.ap-card h2 {
  margin: 8px 0 4px;
  font-size: 1.05rem;
}
.ap-card.is-current {
  border-color: var(--mp-accent);
}
.ap-swatch {
  display: flex;
  height: 28px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--mp-surface-2);
}
.ap-swatch i {
  flex: 1;
}
.ap-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
</style>
