<template>
  <section>
    <h1>Metadata</h1>
    <p class="muted">
      Titles, years, release dates and posters come from TMDB. Get a free API key at themoviedb.org
      → Settings → API.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'metadata' }" />
    <p v-if="!data.providers.length" class="warn">
      No metadata provider is running, so movies can't be added yet.
    </p>
  </section>
</template>

<script lang="ts" setup>
import { useRpc } from '@cordisjs/client'
import type { MetadataData } from '../src/console'

const data = useRpc<MetadataData>()
</script>

<style scoped>
.muted {
  color: var(--mp-muted);
  font-size: 13px;
}
.warn {
  color: #b8860b;
}
</style>
