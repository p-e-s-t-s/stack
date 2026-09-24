<template>
  <section v-if="movie" class="mv">
    <div class="detail">
      <img v-if="movie.posterUrl" class="poster" :src="movie.posterUrl" />
      <div style="flex: 1">
        <h1 style="margin-top: 0">
          {{ movie.title }} <span class="muted">({{ movie.year }})</span>
        </h1>
        <p>{{ movie.overview }}</p>
        <table>
          <tbody>
            <tr v-if="movie.runtimeMinutes">
              <th>Runtime</th>
              <td>{{ movie.runtimeMinutes }} min</td>
            </tr>
            <tr v-if="movie.genres.length">
              <th>Genres</th>
              <td>{{ movie.genres.join(', ') }}</td>
            </tr>
            <tr v-if="movie.inCinemas">
              <th>In cinemas</th>
              <td>{{ movie.inCinemas }}</td>
            </tr>
            <tr v-if="movie.digitalRelease">
              <th>Digital</th>
              <td>{{ movie.digitalRelease }}</td>
            </tr>
            <tr v-if="movie.physicalRelease">
              <th>Physical</th>
              <td>{{ movie.physicalRelease }}</td>
            </tr>
            <tr>
              <th>Folder</th>
              <td class="muted">{{ folder }}</td>
            </tr>
            <tr>
              <th>File</th>
              <td>
                {{
                  movie.file
                    ? `${movie.file.path} · ${movie.file.quality} · ${(movie.file.size / 1024 ** 3).toFixed(1)} GB`
                    : 'none yet'
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <div class="row">
          <label>Profile</label>
          <select
            :value="movie.profileId"
            @change="update({ profileId: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label>Available when</label>
          <select
            :value="movie.minimumAvailability"
            @change="
              update({ minimumAvailability: ($event.target as HTMLSelectElement).value as any })
            "
          >
            <option value="announced">Announced</option>
            <option value="inCinemas">In cinemas</option>
            <option value="released">Released</option>
          </select>
          <label
            ><input
              type="checkbox"
              :checked="movie.monitored"
              @change="update({ monitored: ($event.target as HTMLInputElement).checked })"
            />
            Monitored</label
          >
          <button @click="data.refresh(movie.id)">Refresh</button>
          <button class="danger" @click="remove">Remove</button>
        </div>
      </div>
    </div>
    <!-- other plugins add sections here (interactive search, history…) -->
    <k-slot name="movie-detail" :data="{ movie }" />
  </section>
  <section v-else class="mv"><p class="muted">Movie not found.</p></section>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRoute, useRouter, useRpc } from '@cordisjs/client'
import type { MoviesData } from '../src/console'

const data = useRpc<MoviesData>()
const route = useRoute()
const router = useRouter()
const movie = computed(() => data.value.movies.find((m) => m.id === Number(route.params.id)))
const folder = computed(() => {
  const root = data.value.rootFolders.find((f) => f.id === movie.value?.rootFolderId)
  return root ? `${root.path}/${movie.value!.folder}` : movie.value?.folder
})

const update = (patch: Parameters<MoviesData['update']>[1]) =>
  data.value.update(movie.value!.id, patch)

async function remove() {
  const deleteFiles = !!movie.value!.file && confirm('Also delete the movie folder and its files?')
  await data.value.remove(movie.value!.id, deleteFiles)
  router.push('/movies')
}
</script>
