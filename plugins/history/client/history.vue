<template>
  <section>
    <div class="mp-head"><h1>History</h1></div>
    <p class="mp-lead">Everything Magpie downloaded, imported or gave up on.</p>
    <p v-if="!data.events.length" class="mp-empty">Nothing has happened yet.</p>
    <history-table v-else :events="data.events" show-media />
  </section>
</template>

<script lang="ts" setup>
import { useRpc } from '@cordisjs/client'
import type { HistoryData } from '../src/console'
import HistoryTable from './history-table.vue'

const data = useRpc<HistoryData>()
</script>
