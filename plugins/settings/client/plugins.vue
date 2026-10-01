<template>
  <section>
    <div class="mp-head"><h1>Plugins</h1></div>
    <p class="mp-lead">
      Everything Magpie can connect to or do, and whether it is running. Each one is set up on its
      own page.
    </p>

    <div
      v-for="group in groups"
      :key="group.kind"
      class="mp-card"
      :data-testid="`plugins-${group.kind}`"
    >
      <h2>{{ group.label }}</h2>
      <table class="mp-table">
        <tbody>
          <tr v-for="p in group.rows" :key="p.label">
            <td>
              <strong>{{ p.label }}</strong>
              <div v-if="p.error" class="mp-small mp-error">{{ p.error }}</div>
            </td>
            <td class="mp-muted mp-small">
              <template v-if="p.instances">
                {{ p.instances === 1 ? '1 set up' : `${p.instances} set up` }}
              </template>
            </td>
            <td>
              <span class="mp-badge" :class="BADGE[p.state]">{{ LABEL[p.state] }}</span>
            </td>
            <td>
              <NavLink v-if="p.route" :to="p.route" class="mp-small">{{
                p.state === 'not-set-up' ? 'Set up' : 'Open'
              }}</NavLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import NavLink from '@magpiejs/console-kit/NavLink.vue'
import type { SettingsData } from '../src/console'
import type { PluginState, PluginStatus } from '../src/index'

const LABEL: Record<PluginState, string> = {
  active: 'Running',
  'not-set-up': 'Not set up',
  disabled: 'Off',
  failed: 'Failed',
}
const BADGE: Record<PluginState, string> = {
  active: 'ok',
  'not-set-up': 'info',
  disabled: '',
  failed: 'bad',
}

const data = useRpc<SettingsData>()
const groups = computed(() => {
  const byKind = new Map<string, { kind: string; label: string; rows: PluginStatus[] }>()
  for (const p of data.value.plugins) {
    const group = byKind.get(p.kind) ?? { kind: p.kind, label: p.kindLabel, rows: [] }
    group.rows.push(p)
    byKind.set(p.kind, group)
  }
  return [...byKind.values()]
})
</script>

<style scoped>
.mp-table {
  width: 100%;
}
</style>
