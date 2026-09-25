<template>
  <section v-if="artist" class="mu">
    <a class="mp-back" href="/music" @click.prevent="router.push('/music')">← Music</a>
    <div class="mp-hero">
      <img
        v-if="artist.posterUrl && !coverBroken"
        class="poster"
        :src="artist.posterUrl"
        alt=""
        @error="coverBroken = true"
      />
      <div v-else class="poster placeholder">{{ artist.title }}</div>
      <div class="info">
        <h1>{{ artist.title }}</h1>
        <div class="facts mp-muted">
          <span v-if="artist.overview">{{ artist.overview }}</span>
          <span>{{ profileName }}</span>
          <span
            >{{ artist.albumTypes.join(', ')
            }}{{
              artist.secondaryTypes.length ? ` + ${artist.secondaryTypes.join(', ')}` : ''
            }}</span
          >
        </div>
        <div class="status">
          <span class="mp-badge" :class="status.class">{{ status.text }}</span>
          <span class="mp-muted mp-small mp-count">
            {{ artist.stats.complete }} of {{ artist.stats.wanted }} released albums complete
            <template v-if="artist.stats.nextRelease">
              · next on {{ artist.stats.nextRelease }}</template
            >
          </span>
        </div>
        <div class="mp-row">
          <button
            class="primary"
            data-testid="search-now"
            :disabled="busy === 'search'"
            @click="searchNow()"
          >
            {{ busy === 'search' ? 'Searching…' : 'Search monitored' }}
          </button>
          <button data-testid="edit-artist" @click="editing = !editing">Edit</button>
          <button :disabled="busy === 'refresh'" @click="refresh">
            {{ busy === 'refresh' ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button class="danger" @click="remove">Remove</button>
        </div>
        <p v-if="message" class="mp-small" :class="messageBad ? 'mp-error' : 'mp-muted'">
          {{ message }}
        </p>
      </div>
    </div>

    <div v-if="editing" class="mp-card mp-edit">
      <div class="mp-field">
        <label>Quality profile</label>
        <select
          :value="artist.profileId"
          @change="update({ profileId: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="mp-field">
        <label>Types</label>
        <div class="types">
          <label v-for="t in data.primaryTypes" :key="t">
            <input
              type="checkbox"
              :checked="artist.albumTypes.includes(t)"
              @change="toggle('albumTypes', t)"
            />
            {{ t }}
          </label>
        </div>
      </div>
      <div class="mp-field">
        <label>Also allow</label>
        <div class="types">
          <label v-for="t in ['Live', 'Compilation', 'Soundtrack', 'Remix', 'Demo']" :key="t">
            <input
              type="checkbox"
              :checked="artist.secondaryTypes.includes(t)"
              @change="toggle('secondaryTypes', t)"
            />
            {{ t }}
          </label>
        </div>
        <span class="mp-help">Only albums of these types are monitored when they come out.</span>
      </div>
      <div class="mp-field">
        <label>Monitored</label>
        <div>
          <input
            type="checkbox"
            :checked="artist.monitored"
            @change="update({ monitored: ($event.target as HTMLInputElement).checked })"
          />
        </div>
      </div>
      <div class="mp-field">
        <label>Monitor new albums</label>
        <div>
          <input
            type="checkbox"
            :checked="artist.monitorNew"
            @change="update({ monitorNew: ($event.target as HTMLInputElement).checked })"
          />
        </div>
      </div>
    </div>

    <ReleasePicker
      v-if="picker"
      :key="picker.key"
      :label="picker.label"
      :search="searchReleases"
      :grab="grabRelease"
      @close="picker = undefined"
    />

    <p v-if="!albums" class="mp-muted">Loading…</p>
    <details
      v-for="g in groups"
      :key="g.name"
      class="mp-section"
      :open="g.open"
      :data-testid="`group-${g.name}`"
    >
      <summary>
        <h3>{{ g.name }}</h3>
        <span class="mp-muted mp-small mp-count">{{ g.albums.length }}</span>
      </summary>
      <table class="mp-table albums">
        <tbody>
          <tr
            v-for="a in g.albums"
            :key="a.id"
            :class="{ off: !a.monitored }"
            :data-testid="`album-${a.id}`"
          >
            <td class="mon">
              <input
                type="checkbox"
                :checked="a.monitored"
                title="Monitor this album"
                @change="data.monitorAlbum(a.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="cover-cell">
              <img
                v-if="a.coverUrl && !broken.has(a.id)"
                class="cover"
                :src="a.coverUrl"
                loading="lazy"
                alt=""
                @error="broken.add(a.id)"
              />
              <div v-else class="cover" />
            </td>
            <td>
              <a
                :href="`/music/${artist.id}/${a.id}`"
                @click.prevent="router.push(`/music/${artist.id}/${a.id}`)"
                >{{ a.title }}</a
              >
              <div class="mp-muted mp-small">
                {{ [a.primaryType, ...a.secondaryTypes].filter(Boolean).join(' · ') }}
              </div>
            </td>
            <td class="date mp-muted">{{ a.releaseDate ?? '' }}</td>
            <td class="actions">
              <span class="mp-badge" :class="albumStatus(a).class">{{ albumStatus(a).text }}</span>
              <button class="small" :data-testid="`choose-${a.id}`" @click="choose(a.id, a.title)">
                Choose
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
  <section v-else class="mu"><p class="mp-empty">Artist not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import ReleasePicker from '@magpiejs/console-kit/ReleasePicker.vue'
import type { AlbumRow, MusicData } from '../src/console'
import { albumGroup, albumStatus, artistStatus, GROUPS } from './status'

const data = useRpc<MusicData>()
const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const artist = computed(() => data.value.artists.find((a) => a.id === id.value))
const status = computed(() => artistStatus(artist.value!))
const profileName = computed(
  () => data.value.profiles.find((p) => p.id === artist.value?.profileId)?.name ?? '',
)
const coverBroken = ref(false)
const broken = reactive(new Set<number>())

const albums = ref<AlbumRow[]>()
watch(
  () => [id.value, data.value.revision[id.value]] as const,
  async ([artistId]) => {
    if (!Number.isFinite(artistId)) return
    albums.value = await data.value.albums(artistId)
  },
  { immediate: true },
)
const groups = computed(() =>
  GROUPS.map((name) => {
    const list = (albums.value ?? []).filter((a) => albumGroup(a) === name)
    return { name, albums: list, open: list.some((a) => a.wantedType) }
  }).filter((g) => g.albums.length),
)

const editing = ref(false)
const busy = ref<string>()
const message = ref('')
const messageBad = ref(false)
async function run(what: string, fn: () => Promise<string | void>) {
  busy.value = what
  message.value = ''
  try {
    const text = await fn()
    if (text) {
      message.value = text
      messageBad.value = false
    }
  } catch (e) {
    message.value = (e as Error).message
    messageBad.value = true
  } finally {
    busy.value = undefined
  }
}
const update = (patch: Parameters<MusicData['update']>[1]) =>
  run('update', () => data.value.update(id.value, patch))
function toggle(key: 'albumTypes' | 'secondaryTypes', type: string) {
  const current = artist.value![key]
  void update({
    [key]: current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
  })
}
const refresh = () =>
  run('refresh', async () => {
    await data.value.refresh(id.value)
    return 'Updated from MusicBrainz.'
  })
const searchNow = () => run('search', () => data.value.searchNow(id.value))

const picker = ref<{ key: number; albumIds: number[]; label: string }>()
const choose = (albumId: number, label: string) =>
  (picker.value = { key: Date.now(), albumIds: [albumId], label })
const searchReleases = () => data.value.search(id.value, picker.value!.albumIds)
const grabRelease = (guid: string) => data.value.grab(id.value, guid)

async function remove() {
  if (!confirm(`Remove ${artist.value!.title} from Magpie?`)) return
  const deleteFiles =
    artist.value!.stats.complete > 0 && confirm('Also delete their folder and files from disk?')
  await data.value.remove(id.value, deleteFiles)
  router.push('/music')
}
</script>
