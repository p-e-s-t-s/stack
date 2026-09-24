<template>
  <section class="pc">
    <div class="mp-head"><h1>Add podcast</h1></div>
    <div class="tabs">
      <button
        v-for="(label, key) in TABS"
        :key="key"
        :class="{ primary: tab === key }"
        :data-testid="`tab-${key}`"
        @click="tab = key"
      >
        {{ label }}
      </button>
    </div>

    <div v-if="!data.rootFolders.length" class="mp-card">
      Add a Podcasts root folder in
      <a href="/settings/media" @click.prevent="router.push('/settings/media')">Media management</a>
      first.
    </div>
    <div v-else class="mp-card options">
      <label v-if="data.rootFolders.length > 1">
        <span>Folder</span>
        <select v-model="form.rootFolderId">
          <option v-for="f in data.rootFolders" :key="f.id" :value="f.id">{{ f.path }}</option>
        </select>
      </label>
      <label>
        <span>Download</span>
        <select v-model="form.monitor" data-testid="monitor">
          <option value="new">New episodes only</option>
          <option value="latest">The newest few, then new ones</option>
          <option value="all">Every episode</option>
          <option value="none">Nothing (pick episodes yourself)</option>
        </select>
      </label>
      <label v-if="form.monitor === 'latest'">
        <span>How many</span>
        <input v-model.number="form.latestCount" type="number" min="1" style="width: 80px" />
      </label>
      <label>
        <span>Keep</span>
        <select v-model="form.keepLatest" data-testid="keep">
          <option :value="null">Every downloaded episode</option>
          <option v-for="n in [1, 3, 5, 10, 25]" :key="n" :value="n">The newest {{ n }}</option>
        </select>
      </label>
    </div>

    <template v-if="tab === 'search'">
      <form class="mp-row search" @submit.prevent="search">
        <input v-model="term" placeholder="Search for a podcast" data-testid="lookup" autofocus />
        <button class="primary" type="submit" :disabled="!term.trim() || busy">
          {{ busy === 'search' ? 'Searching…' : 'Search' }}
        </button>
      </form>
      <p v-if="error" class="mp-error">{{ error }}</p>
      <div v-for="r in results" :key="r.ids.itunes" class="result" data-testid="lookup-result">
        <img v-if="r.posterUrl" class="poster" :src="r.posterUrl" alt="" />
        <div v-else class="poster placeholder" />
        <div class="body">
          <div class="title">
            <strong>{{ r.title }}</strong> <span class="mp-muted">{{ r.author }}</span>
          </div>
          <p class="mp-muted overview">{{ r.overview }}</p>
        </div>
        <div class="action">
          <button v-if="r.libraryId" @click="router.push(`/podcasts/${r.libraryId}`)">
            Following
          </button>
          <button
            v-else
            class="primary"
            :disabled="!form.rootFolderId || !r.feedUrl || !!busy"
            data-testid="add"
            @click="add(r.feedUrl!, r.ids.itunes)"
          >
            {{ busy === r.feedUrl ? 'Adding…' : 'Follow' }}
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'url'">
      <form class="mp-row search" @submit.prevent="preview">
        <input
          v-model="feedUrl"
          type="url"
          placeholder="https://example.com/feed.xml"
          data-testid="feed-url"
        />
        <button type="submit" :disabled="!feedUrl.trim() || !!busy">
          {{ busy === 'preview' ? 'Reading…' : 'Preview' }}
        </button>
      </form>
      <p v-if="error" class="mp-error">{{ error }}</p>
      <div v-if="feed" class="mp-card preview" data-testid="preview">
        <img v-if="feed.imageUrl" class="poster" :src="feed.imageUrl" alt="" />
        <div class="body">
          <div class="title">
            <strong>{{ feed.title }}</strong> <span class="mp-muted">{{ feed.author }}</span>
          </div>
          <p class="mp-muted mp-small">
            {{ feed.episodes }} episodes<template v-if="feed.latest">
              · latest {{ day(feed.latest) }}</template
            >
          </p>
          <p class="mp-muted overview">{{ feed.description }}</p>
          <button v-if="feed.libraryId" @click="router.push(`/podcasts/${feed.libraryId}`)">
            Following
          </button>
          <button
            v-else
            class="primary"
            :disabled="!form.rootFolderId || !!busy"
            data-testid="add"
            @click="add(feedUrl)"
          >
            {{ busy === feedUrl ? 'Adding…' : 'Follow' }}
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <p class="mp-muted">
        Import the subscriptions exported from another podcast app. Podcasts you already follow are
        skipped.
      </p>
      <input
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml"
        data-testid="opml-file"
        :disabled="!form.rootFolderId || !!busy"
        @change="importOpml"
      />
      <p v-if="busy === 'opml'" class="mp-muted">Importing… (each feed is read once)</p>
      <p v-if="error" class="mp-error">{{ error }}</p>
      <div v-if="imported" class="mp-card more" data-testid="opml-result">
        <p>
          Followed {{ imported.added.length }}, skipped {{ imported.skipped.length }} already
          followed.
        </p>
        <p v-for="f in imported.failed" :key="f" class="mp-error mp-small">{{ f }}</p>
        <button @click="router.push('/podcasts')">Go to Podcasts</button>
      </div>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { FeedPreview, PodcastsData } from '../src/console'
import type { MonitorOption } from '../src/schema'
import { day } from './status'

const TABS = { search: 'Search', url: 'Feed URL', opml: 'Import OPML' } as const

const data = useRpc<PodcastsData>()
const router = useRouter()
const tab = ref<keyof typeof TABS>('search')
const term = ref('')
const feedUrl = ref('')
const error = ref('')
const busy = ref<string>()
const results = ref<Awaited<ReturnType<PodcastsData['lookup']>>>([])
const feed = ref<FeedPreview>()
const imported = ref<Awaited<ReturnType<PodcastsData['importOpml']>>>()
const form = reactive({
  rootFolderId: data.value.rootFolders[0]?.id,
  monitor: 'new' as MonitorOption,
  latestCount: 3,
  keepLatest: null as number | null,
})

watch(tab, () => (error.value = ''))
watch(
  () => data.value.rootFolders,
  (folders) => {
    if (!folders.some((f) => f.id === form.rootFolderId)) form.rootFolderId = folders[0]?.id
  },
  { deep: true },
)

async function run<T>(what: string, fn: () => Promise<T>) {
  error.value = ''
  busy.value = what
  try {
    return await fn()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = undefined
  }
}

async function search() {
  const found = await run('search', () => data.value.lookup(term.value))
  results.value = found ?? []
  if (found && !found.length) error.value = 'Nothing found. Try the feed URL instead.'
}

async function preview() {
  feed.value = await run('preview', () => data.value.preview(feedUrl.value))
}

async function add(url: string, itunesId?: string) {
  const id = await run(url, () =>
    data.value.add({ ...form, feedUrl: url, itunesId, rootFolderId: form.rootFolderId! }),
  )
  if (id) router.push(`/podcasts/${id}`)
}

async function importOpml(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const xml = await file.text()
  imported.value = await run('opml', () =>
    data.value.importOpml(xml, {
      rootFolderId: form.rootFolderId!,
      monitor: form.monitor === 'latest' ? 'new' : form.monitor,
    }),
  )
}
</script>
