<template>
  <section>
    <h1>History</h1>
    <p v-if="!data.events.length" style="color: var(--mp-muted)">Nothing has happened yet.</p>
    <history-table v-else :events="data.events" show-media />
  </section>
</template>

<script lang="ts" setup>
import { useRpc } from '@cordisjs/client'
import type { HistoryData } from '../src/console'
import HistoryTable from './history-table.vue'

const data = useRpc<HistoryData>()
</script>
