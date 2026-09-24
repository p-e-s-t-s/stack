<template>
  <div class="mp-card" data-testid="queue-widget">
    <strong>Job queue</strong>
    <span v-for="status in statuses" :key="status" style="margin-left: 16px">
      {{ status }}: {{ data.jobs[status] ?? 0 }}
    </span>
  </div>
</template>

<script lang="ts" setup>
import { useRpc } from '@cordisjs/client'
import type { SystemData } from '../src'

const data = useRpc<SystemData>()
const statuses = ['pending', 'running', 'done', 'failed']
</script>
