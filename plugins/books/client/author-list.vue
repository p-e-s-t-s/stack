<template>
  <section class="bk">
    <div class="mp-head">
      <h1>Books</h1>
      <input v-if="data.authors.length" v-model="filter" placeholder="Filter" class="filter" />
      <button class="primary" data-testid="add-author" @click="router.push('/books/add')">
        Add author
      </button>
    </div>
    <p v-if="data.authors.length" class="mp-lead">{{ summary }}</p>
    <div
      v-if="!data.rootFolders.ebook.length && !data.rootFolders.audiobook.length"
      class="mp-card"
    >
      Add an <strong>Ebooks</strong> or <strong>Audiobooks</strong> root folder in
      <a href="/settings/media" @click.prevent="router.push('/settings/media')">Media management</a>
      to start following authors.
    </div>

    <p v-if="!data.authors.length" class="mp-empty">
      No authors yet. Use <strong>Add author</strong> to find one by name or by a book they wrote.
    </p>
    <div class="grid">
      <a
        v-for="a in shown"
        :key="a.authorId"
        class="card"
        :href="`/books/${followIdOf(a)}`"
        data-testid="author-card"
        @click.prevent="router.push(`/books/${followIdOf(a)}`)"
      >
        <img
          v-if="a.photoUrl && !broken.has(a.authorId)"
          class="poster"
          :src="a.photoUrl"
          loading="lazy"
          alt=""
          @error="broken.add(a.authorId)"
        />
        <div v-else class="poster placeholder">{{ a.name }}</div>
        <div class="title">{{ a.name }}</div>
        <div class="meta">
          <span class="formats">
            <span v-for="k in KINDS.filter((k) => a.formats[k])" :key="k" class="mp-badge">{{
              ONE[k]
            }}</span>
          </span>
          <span class="mp-badge" :class="authorStatus(a).class">{{ authorStatus(a).text }}</span>
        </div>
      </a>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, reactive, ref } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { BooksData } from '../src/console'
import { authorStatus, followIdOf, KINDS, ONE } from './status'

const data = useRpc<BooksData>()
const router = useRouter()
const filter = ref('')
const broken = reactive(new Set<number>())
const shown = computed(() =>
  data.value.authors.filter((a) => a.name.toLowerCase().includes(filter.value.toLowerCase())),
)
const summary = computed(() => {
  const formats = data.value.authors.flatMap((a) => Object.values(a.formats))
  const downloaded = formats.reduce((n, f) => n + f.stats.downloaded, 0)
  const missing = formats.reduce((n, f) => n + f.stats.wanted - f.stats.downloaded, 0)
  return `${data.value.authors.length} authors · ${downloaded} books downloaded · ${missing} missing`
})
</script>
