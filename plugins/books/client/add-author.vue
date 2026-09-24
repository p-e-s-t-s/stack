<template>
  <section class="bk">
    <div class="mp-head"><h1>Add author</h1></div>
    <form class="mp-row search" @submit.prevent="search">
      <input
        v-model="term"
        placeholder="An author's name, or the title of a book they wrote"
        data-testid="lookup"
        autofocus
      />
      <button class="primary" type="submit" :disabled="!term.trim() || searching">
        {{ searching ? 'Searching…' : 'Search' }}
      </button>
    </form>
    <p v-if="error" class="mp-error">{{ error }}</p>

    <template v-if="results.length">
      <div class="add-formats">
        <div v-for="k in KINDS" :key="k" class="mp-card" :data-testid="`format-${k}`">
          <label class="check">
            <input
              v-model="form[k].enabled"
              type="checkbox"
              :disabled="!data.rootFolders[k].length"
            />
            <span>{{ LABEL[k] }}</span>
          </label>
          <p v-if="!data.rootFolders[k].length" class="mp-muted mp-small">
            Add {{ k === 'ebook' ? 'an Ebooks' : 'an Audiobooks' }} root folder in
            <a href="/settings/media" @click.prevent="router.push('/settings/media')"
              >Media management</a
            >
            first.
          </p>
          <template v-else-if="form[k].enabled">
            <label>
              <span>Quality</span>
              <select v-model="form[k].profileId">
                <option v-for="p in data.profiles[k]" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </label>
            <label v-if="data.rootFolders[k].length > 1">
              <span>Folder</span>
              <select v-model="form[k].rootFolderId">
                <option v-for="f in data.rootFolders[k]" :key="f.id" :value="f.id">
                  {{ f.path }}
                </option>
              </select>
            </label>
          </template>
        </div>
      </div>
      <div class="mp-card options">
        <label>
          <span>Monitor</span>
          <select v-model="monitor" data-testid="monitor">
            <option value="all">All books</option>
            <option value="latest">The newest book, and future ones</option>
            <option value="future">Future books only</option>
            <option value="none">None (pick books yourself)</option>
          </select>
        </label>
        <label class="check">
          <input v-model="startSearch" type="checkbox" />
          <span>Start searching right away</span>
        </label>
      </div>

      <div v-for="r in results" :key="r.ids.openlibrary" class="result" data-testid="lookup-result">
        <img
          v-if="r.posterUrl && !broken.has(r.ids.openlibrary!)"
          class="poster"
          :src="r.posterUrl"
          alt=""
          @error="broken.add(r.ids.openlibrary!)"
        />
        <div v-else class="poster placeholder" />
        <div class="body">
          <div class="title">
            <strong>{{ r.title }}</strong>
          </div>
          <p class="mp-muted overview">{{ r.overview }}</p>
        </div>
        <div class="action">
          <button
            v-if="chosen.every((k) => r.followed[k])"
            @click="router.push(`/books/${Object.values(r.followed)[0]}`)"
          >
            Following
          </button>
          <button
            v-else
            class="primary"
            :disabled="!chosen.length || !!adding"
            data-testid="add"
            @click="add(r)"
          >
            {{ adding === r.ids.openlibrary ? 'Adding…' : 'Follow' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { BooksData } from '../src/console'
import type { MonitorOption } from '../src/schema'
import { KINDS, LABEL } from './status'

const data = useRpc<BooksData>()
const router = useRouter()
const term = ref('')
const error = ref('')
const searching = ref(false)
const adding = ref<string>()
const broken = reactive(new Set<string>())
const results = ref<Awaited<ReturnType<BooksData['lookup']>>>([])
const monitor = ref<MonitorOption>('all')
const startSearch = ref(true)

const defaults = (k: (typeof KINDS)[number]) => ({
  enabled: k === 'ebook' ? !!data.value.rootFolders.ebook.length : false,
  profileId: data.value.profiles[k][0]?.id,
  rootFolderId: data.value.rootFolders[k][0]?.id,
})
const form = reactive({ ebook: defaults('ebook'), audiobook: defaults('audiobook') })
const chosen = computed(() => KINDS.filter((k) => form[k].enabled))

watch(
  () => [data.value.profiles, data.value.rootFolders] as const,
  () => {
    for (const k of KINDS) {
      const f = form[k]
      if (!data.value.profiles[k].some((p) => p.id === f.profileId))
        f.profileId = data.value.profiles[k][0]?.id
      if (!data.value.rootFolders[k].some((r) => r.id === f.rootFolderId))
        f.rootFolderId = data.value.rootFolders[k][0]?.id
      if (!f.rootFolderId) f.enabled = false
    }
  },
  { deep: true },
)

async function search() {
  error.value = ''
  searching.value = true
  try {
    results.value = await data.value.lookup(term.value)
    if (!results.value.length) error.value = 'Nothing found.'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    searching.value = false
  }
}

async function add(r: (typeof results.value)[number]) {
  error.value = ''
  adding.value = r.ids.openlibrary
  try {
    let first: number | undefined
    for (const k of chosen.value) {
      if (r.followed[k]) continue
      const id = await data.value.follow({
        authorId: r.ids.openlibrary!,
        kind: k,
        profileId: form[k].profileId!,
        rootFolderId: form[k].rootFolderId!,
        monitor: monitor.value,
        search: startSearch.value,
      })
      first ??= id
    }
    router.push(`/books/${first ?? Object.values(r.followed)[0]}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    adding.value = undefined
  }
}
</script>
