<template>
  <section v-if="author" class="bk">
    <a class="mp-back" href="/books" @click.prevent="router.push('/books')">← Books</a>
    <div class="mp-hero">
      <img
        v-if="author.photoUrl && !photoBroken"
        class="poster"
        :src="author.photoUrl"
        alt=""
        @error="photoBroken = true"
      />
      <div v-else class="poster placeholder">{{ author.name }}</div>
      <div class="info">
        <h1>{{ author.name }}</h1>
        <p class="overview">{{ author.overview }}</p>
        <div class="mp-row">
          <button :disabled="busy === 'refresh'" @click="refresh">
            {{ busy === 'refresh' ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button
            v-for="k in KINDS.filter((k) => !author!.formats[k] && data.rootFolders[k].length)"
            :key="k"
            :data-testid="`follow-${k}`"
            @click="followAlso(k)"
          >
            Also follow {{ LABEL[k].toLowerCase() }}
          </button>
        </div>
        <p v-if="message" class="mp-small" :class="messageBad ? 'mp-error' : 'mp-muted'">
          {{ message }}
        </p>
      </div>
    </div>

    <div class="format-cards">
      <div v-for="k in followed" :key="k" class="mp-card" :data-testid="`format-${k}`">
        <h3>{{ LABEL[k] }}</h3>
        <div class="status">
          <span class="mp-badge" :class="formatBadge(k).class">{{ formatBadge(k).text }}</span>
          <span class="mp-muted mp-small mp-count">
            {{ author.formats[k]!.stats.downloaded }} of
            {{ author.formats[k]!.stats.wanted }} released books<template
              v-if="author.formats[k]!.stats.nextRelease"
            >
              · next on {{ author.formats[k]!.stats.nextRelease }}</template
            >
          </span>
        </div>
        <div class="mp-field">
          <label>Quality profile</label>
          <select
            :value="author.formats[k]!.profileId"
            @change="update(k, { profileId: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="p in data.profiles[k]" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <label class="mp-small"
          ><input
            type="checkbox"
            :checked="author.formats[k]!.monitored"
            @change="update(k, { monitored: ($event.target as HTMLInputElement).checked })"
          />
          Monitored</label
        >
        &nbsp;
        <label class="mp-small"
          ><input
            type="checkbox"
            :checked="author.formats[k]!.monitorNew"
            @change="update(k, { monitorNew: ($event.target as HTMLInputElement).checked })"
          />
          Monitor new books</label
        >
        <div class="mp-row">
          <button
            class="primary small"
            :data-testid="`search-${k}`"
            :disabled="busy === `search-${k}`"
            @click="searchNow(k)"
          >
            {{ busy === `search-${k}` ? 'Searching…' : 'Search monitored' }}
          </button>
          <button class="danger small" @click="remove(k)">Stop following</button>
        </div>
      </div>
    </div>

    <ReleasePicker
      v-if="chosen"
      :key="chosen.label"
      :label="chosen.label"
      :search="searchReleases"
      :grab="grabRelease"
      @close="chosen = undefined"
    />

    <div class="mp-head">
      <h2>Books</h2>
      <input v-if="bookRows?.length" v-model="filter" placeholder="Filter" class="filter" />
    </div>
    <p v-if="!bookRows" class="mp-muted">Loading…</p>
    <p v-else-if="!bookRows.length" class="mp-empty">No books found for this author.</p>
    <table v-else class="mp-table bookrow-table">
      <thead>
        <tr>
          <th />
          <th>Book</th>
          <th v-for="k in followed" :key="k">{{ ONE[k] }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="b in shown"
          :key="b.id"
          class="bookrow"
          :class="{ unreleased: !b.released }"
          :data-testid="`book-${b.id}`"
        >
          <td class="cover-cell">
            <img v-if="b.coverUrl" class="cover" :src="b.coverUrl" loading="lazy" alt="" />
            <div v-else class="cover" />
          </td>
          <td>
            <div>{{ b.title }}</div>
            <div class="mp-muted mp-small">
              {{ b.releaseDate ?? b.year ?? ''
              }}<template v-if="b.subtitle"> · {{ b.subtitle }}</template>
            </div>
            <template v-for="k in followed" :key="k">
              <div
                v-for="f in b.formats[k]?.files ?? []"
                :key="f.path"
                class="mp-muted mp-small mono"
              >
                {{ f.path }}
              </div>
            </template>
          </td>
          <td v-for="k in followed" :key="k" class="fmt">
            <div v-if="b.formats[k]" class="line">
              <input
                type="checkbox"
                :checked="b.formats[k]!.monitored"
                :title="`Monitor as ${ONE[k].toLowerCase()}`"
                @change="
                  data.monitorBook(
                    author.formats[k]!.id,
                    b.id,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span class="mp-badge" :class="formatStatus(b, b.formats[k]!).class">{{
                formatStatus(b, b.formats[k]!).text
              }}</span>
              <button
                class="small"
                title="See releases"
                :data-testid="`choose-${k}-${b.id}`"
                @click="choose(k, b)"
              >
                Choose
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <button v-if="filtered.length > limit" class="more" @click="limit += 100">
      Show {{ Math.min(100, filtered.length - limit) }} more
    </button>
  </section>
  <section v-else class="bk"><p class="mp-empty">Author not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import ReleasePicker from '@magpiejs/console-kit/ReleasePicker.vue'
import type { BookRow, BooksData } from '../src/console'
import { formatStatus, KINDS, LABEL, ONE } from './status'

type Kind = (typeof KINDS)[number]

const data = useRpc<BooksData>()
const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const author = computed(() =>
  data.value.authors.find((a) => Object.values(a.formats).some((f) => f.id === id.value)),
)
const followed = computed(() => KINDS.filter((k) => author.value?.formats[k]))
const photoBroken = ref(false)

// books are fetched per author, and again whenever the author changes
const bookRows = ref<BookRow[]>()
watch(
  () =>
    [author.value?.authorId, author.value && data.value.revision[author.value.authorId]] as const,
  async ([authorId]) => {
    if (authorId === undefined) return
    bookRows.value = await data.value.books(authorId)
  },
  { immediate: true },
)

const filter = ref('')
const limit = ref(50)
const filtered = computed(() =>
  (bookRows.value ?? []).filter((b) => b.title.toLowerCase().includes(filter.value.toLowerCase())),
)
const shown = computed(() => filtered.value.slice(0, limit.value))

function formatBadge(k: Kind) {
  const f = author.value!.formats[k]!
  if (!f.monitored) return { text: 'Not monitored', class: '' }
  const missing = f.stats.wanted - f.stats.downloaded
  return missing ? { text: `${missing} missing`, class: 'bad' } : { text: 'Complete', class: 'ok' }
}

const busy = ref<string>()
const message = ref('')
const messageBad = ref(false)
function say(text: string, bad = false) {
  message.value = text
  messageBad.value = bad
}
async function run(what: string, fn: () => Promise<string | void>) {
  busy.value = what
  say('')
  try {
    const text = await fn()
    if (text) say(text)
  } catch (e) {
    say((e as Error).message, true)
  } finally {
    busy.value = undefined
  }
}

const followId = (k: Kind) => author.value!.formats[k]!.id
const update = (k: Kind, patch: Parameters<BooksData['update']>[1]) =>
  run('update', () => data.value.update(followId(k), patch))
const refresh = () =>
  run('refresh', async () => {
    await data.value.refresh(id.value)
    return 'Updated from Open Library.'
  })
const searchNow = (k: Kind, bookIds?: number[]) =>
  run(`search-${k}`, () => data.value.searchNow(followId(k), bookIds))

function followAlso(k: Kind) {
  return run('follow', async () => {
    await data.value.follow({
      authorId: author.value!.openlibraryId,
      kind: k,
      profileId: data.value.profiles[k][0]!.id,
      rootFolderId: data.value.rootFolders[k][0]!.id,
      monitor: 'none',
      search: false,
    })
    return `Following as ${LABEL[k].toLowerCase()}: tick the books you want.`
  })
}

async function remove(k: Kind) {
  const f = author.value!.formats[k]!
  if (!confirm(`Stop following ${author.value!.name} as ${LABEL[k].toLowerCase()}?`)) return
  const deleteFiles =
    f.stats.downloaded > 0 && confirm('Also delete the downloaded books from disk?')
  const other = KINDS.find((o) => o !== k && author.value!.formats[o])
  const otherId = other && author.value!.formats[other]!.id
  await data.value.remove(f.id, deleteFiles)
  router.push(otherId ? `/books/${otherId}` : '/books')
}

const chosen = ref<{ label: string; kind: Kind; bookId: number }>()
function choose(k: Kind, b: BookRow) {
  chosen.value = { label: `${b.title} (${ONE[k].toLowerCase()})`, kind: k, bookId: b.id }
}
const searchReleases = () => data.value.search(followId(chosen.value!.kind), [chosen.value!.bookId])
const grabRelease = (guid: string) => data.value.grab(followId(chosen.value!.kind), guid)
</script>
