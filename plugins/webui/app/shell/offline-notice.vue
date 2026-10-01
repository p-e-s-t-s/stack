<template>
  <div v-if="ready && !connected" class="mp-offline" role="status">
    Lost the connection to Magpie. Reconnecting…
  </div>
</template>

<script lang="ts" setup>
import { useConnection } from '@magpiejs/console-kit/theme'

const { ready, connected } = useConnection()
</script>
