<template>
  <div v-if="events.length" data-testid="media-history">
    <h2>History</h2>
    <history-table :events="events" />
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { HistoryData } from '../src/console'
import HistoryTable from './history-table.vue'

// for kinds whose detail pages pass `mediaIds` (authors, artists) or a single `podcast`
const props = defineProps<{ mediaIds?: number[]; podcast?: { id: number } }>()
const data = useRpc<HistoryData>()
const ids = computed(() => props.mediaIds ?? (props.podcast ? [props.podcast.id] : []))
const events = computed(() => data.value.events.filter((e) => ids.value.includes(e.mediaId)))
</script>
