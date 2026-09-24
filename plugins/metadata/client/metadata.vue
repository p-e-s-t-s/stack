<template>
  <section>
    <div class="mp-head"><h1>Metadata</h1></div>
    <p class="mp-lead">
      Titles, release dates and posters come from TMDB. Get a free API key at
      <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer"
        >themoviedb.org → Settings → API</a
      >.
    </p>
    <k-slot name="provider-settings" :data="{ kind: 'metadata' }" />
    <p v-if="!data.providers.length" class="mp-card warn">
      TMDB isn't running yet: add or enable it with your API key to look up movies.
    </p>
  </section>
</template>

<script lang="ts" setup>
import { useRpc } from '@cordisjs/client'
import type { MetadataData } from '../src/console'

const data = useRpc<MetadataData>()
</script>

<style scoped>
.warn {
  margin-top: 16px;
  background: var(--mp-warn-soft);
  border-color: transparent;
  color: var(--mp-warn);
}
</style>
