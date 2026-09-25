<template>
  <section v-if="artist" class="mu">
    <a
      class="mp-back"
      :href="`/music/${artist.id}`"
      @click.prevent="router.push(`/music/${artist.id}`)"
      >← {{ artist.title }}</a
    >
    <p v-if="error" class="mp-error">{{ error }}</p>
    <template v-if="detail">
      <div class="mp-hero">
        <img
          v-if="detail.album.coverUrl && !coverBroken"
          class="poster"
          :src="detail.album.coverUrl"
          alt=""
          @error="coverBroken = true"
        />
        <div v-else class="poster placeholder">{{ detail.album.title }}</div>
        <div class="info">
          <h1>
            {{ detail.album.title }}
            <span class="mp-muted year">{{ detail.album.releaseDate?.slice(0, 4) }}</span>
          </h1>
          <div class="facts mp-muted">
            <span>{{
              [detail.album.primaryType, ...detail.album.secondaryTypes].filter(Boolean).join(' · ')
            }}</span>
            <span v-if="detail.album.releaseDate">{{ detail.album.releaseDate }}</span>
            <span v-if="length">{{ length }}</span>
          </div>
          <div class="status">
            <span class="mp-badge" :class="albumStatus(detail.album).class">{{
              albumStatus(detail.album).text
            }}</span>
            <label class="mp-small"
              ><input
                type="checkbox"
                :checked="detail.album.monitored"
                @change="
                  data.monitorAlbum(detail.album.id, ($event.target as HTMLInputElement).checked)
                "
              />
              Monitored</label
            >
          </div>
          <div class="mp-row">
            <button class="primary" :disabled="busy" data-testid="search-album" @click="searchNow">
              {{ busy ? 'Searching…' : 'Search' }}
            </button>
            <button data-testid="choose-album" @click="picker = Date.now()">Choose</button>
          </div>
          <p v-if="message" class="mp-small mp-muted">{{ message }}</p>
        </div>
      </div>

      <ReleasePicker
        v-if="picker"
        :key="picker"
        :label="detail.album.title"
        :search="searchReleases"
        :grab="grabRelease"
        @close="picker = undefined"
      />

      <h2>Tracks</h2>
      <table class="mp-table tracks">
        <tbody>
          <template v-for="disc in discs" :key="disc">
            <tr v-if="discs.length > 1" class="disc-head">
              <td colspan="4">Disc {{ disc }}</td>
            </tr>
            <tr
              v-for="t in detail.tracks.filter((x) => x.disc === disc)"
              :key="t.id"
              :data-testid="`track-${t.disc}-${t.number}`"
            >
              <td class="num">{{ t.number }}</td>
              <td>
                {{ t.title }}
                <div v-if="t.file" class="mp-muted mp-small mono">{{ t.file.path }}</div>
              </td>
              <td class="len">{{ duration(t.lengthMs) }}</td>
              <td class="state">
                <span v-if="t.file" class="mp-badge ok">{{ t.file.quality }}</span>
                <span
                  v-else-if="detail.album.released"
                  class="mp-badge"
                  :class="detail.album.monitored ? 'bad' : ''"
                  >Missing</span
                >
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
    <p v-else-if="!error" class="mp-muted">Loading the track list…</p>
  </section>
  <section v-else class="mu"><p class="mp-empty">Artist not found.</p></section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import ReleasePicker from '@magpiejs/console-kit/ReleasePicker.vue'
import type { MusicData } from '../src/console'
import { albumStatus, duration } from './status'

const data = useRpc<MusicData>()
const route = useRoute()
const router = useRouter()
const artist = computed(() => data.value.artists.find((a) => a.id === Number(route.params.id)))
const albumId = computed(() => Number(route.params.albumId))
const detail = ref<Awaited<ReturnType<MusicData['album']>>>()
const error = ref('')
const coverBroken = ref(false)
const busy = ref(false)
const message = ref('')
const picker = ref<number>()
const searchReleases = () => data.value.search(artist.value!.id, [albumId.value])
const grabRelease = (guid: string) => data.value.grab(artist.value!.id, guid)

watch(
  () => [albumId.value, artist.value && data.value.revision[artist.value.id]] as const,
  async ([id]) => {
    if (!Number.isFinite(id)) return
    try {
      detail.value = await data.value.album(id)
      error.value = ''
    } catch (e) {
      error.value = (e as Error).message
    }
  },
  { immediate: true },
)

const discs = computed(() => [...new Set(detail.value?.tracks.map((t) => t.disc))])
const length = computed(() => {
  const ms = detail.value?.tracks.reduce((n, t) => n + (t.lengthMs ?? 0), 0) ?? 0
  return ms ? `${Math.round(ms / 60_000)} min` : ''
})

async function searchNow() {
  busy.value = true
  try {
    message.value = await data.value.searchNow(artist.value!.id, [albumId.value])
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>
