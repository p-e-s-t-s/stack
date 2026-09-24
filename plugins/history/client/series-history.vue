<template>
  <div v-if="events.length" data-testid="series-history">
    <h2>History</h2>
    <history-table :events="events" />
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { HistoryData } from '../src/console'
import HistoryTable from './history-table.vue'

const props = defineProps<{ series: { id: number } }>()
const data = useRpc<HistoryData>()
const events = computed(() => data.value.events.filter((e) => e.mediaId === props.series.id))
</script>
