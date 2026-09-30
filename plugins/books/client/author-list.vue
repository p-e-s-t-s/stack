<template>
  <MediaCardGrid
    class="bk"
    title="Books"
    :items="data.authors"
    :item-key="(a) => a.authorId"
    :item-title="(a) => a.name"
    :item-href="(a) => `/books/${followIdOf(a)}`"
    :item-image="(a) => a.photoUrl"
    :summary="summary"
    card-test-id="author-card"
  >
    <template #actions>
      <button class="primary" data-testid="add-author" @click="router.push('/books/add')">
        Add author
      </button>
    </template>
    <template #notices>
      <LocationNotice v-if="!data.rootFolders.ebook.length && !data.rootFolders.audiobook.length">
        to start following authors.
      </LocationNotice>
    </template>
    <template #empty>
      No authors yet. Use <strong>Add author</strong> to find one by name or by a book they wrote.
    </template>
    <template #meta="{ item: a }">
      <span class="formats">
        <span v-for="k in KINDS.filter((k) => a.formats[k])" :key="k" class="mp-badge">{{
          ONE[k]
        }}</span>
      </span>
      <span class="mp-badge" :class="authorStatus(a).class">{{ authorStatus(a).text }}</span>
    </template>
  </MediaCardGrid>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import LocationNotice from '@magpiejs/console-kit/LocationNotice.vue'
import MediaCardGrid from '@magpiejs/console-kit/MediaCardGrid.vue'
import type { BooksData } from '../src/console'
import { authorStatus, followIdOf, KINDS, ONE } from './status'

const data = useRpc<BooksData>()
const router = useRouter()
const summary = computed(() => {
  const formats = data.value.authors.flatMap((a) => Object.values(a.formats))
  const downloaded = formats.reduce((n, f) => n + f.stats.downloaded, 0)
  const missing = formats.reduce((n, f) => n + f.stats.wanted - f.stats.downloaded, 0)
  return `${data.value.authors.length} authors · ${downloaded} books downloaded · ${missing} missing`
})
</script>
