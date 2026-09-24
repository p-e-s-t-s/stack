<template>
  <section class="lib">
    <div class="mp-head"><h1>Media management</h1></div>

    <h2>Root folders</h2>
    <p class="mp-lead">Where your library lives. Each movie gets its own folder inside.</p>
    <table v-if="data.rootFolders.length" class="mp-table">
      <tbody>
        <tr v-for="f in data.rootFolders" :key="f.id">
          <td class="mono">{{ f.path }}</td>
          <td class="mp-muted">{{ kindLabel(f.kind) }}</td>
          <td class="actions">
            <button class="small danger" @click="data.removeRootFolder(f.id)">Remove</button>
          </td>
        </tr>
      </tbody>
    </table>
    <form class="mp-row add" @submit.prevent="add">
      <input v-model="path" placeholder="/data/media/movies" class="path" data-testid="root-path" />
      <select v-model="kind">
        <option v-for="k in data.kinds" :key="k.id" :value="k.id">{{ k.label }}</option>
      </select>
      <button class="primary" type="submit" :disabled="!path.trim()" data-testid="add-root">
        Add folder
      </button>
    </form>
    <p v-if="error" class="mp-error">{{ error }}</p>

    <h2>Files</h2>
    <div class="mp-card">
      <div class="mp-field">
        <label for="movie-folder">Movie folder</label>
        <input id="movie-folder" v-model="naming.movieFolder" />
      </div>
      <div class="mp-field">
        <label for="movie-file">Movie file</label>
        <input id="movie-file" v-model="naming.movieFile" />
        <span class="mp-help">
          Tokens: <code>{Title}</code> <code>{Year}</code> <code>{Quality}</code>
          <code>{Edition}</code> <code>{Group}</code> <code>{Resolution}</code>
          <code>{Source}</code>. The extension is added for you.
        </span>
      </div>
      <div class="mp-field">
        <label for="hardlinks">Use hardlinks</label>
        <div><input id="hardlinks" v-model="naming.useHardlinks" type="checkbox" /></div>
        <span class="mp-help">
          Torrents keep seeding without using extra space. Needs downloads and library on the same
          drive; otherwise Magpie copies.
        </span>
      </div>
      <div class="mp-field">
        <label for="recycle">Recycle bin</label>
        <input id="recycle" v-model="naming.recycleBin" placeholder="Leave empty to delete" />
        <span class="mp-help">Replaced files are moved here instead of deleted.</span>
      </div>
      <div class="mp-row save">
        <button class="primary" @click="save">Save</button>
        <span v-if="saved" class="mp-muted">Saved.</span>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { LibraryData } from '../src/console'

const data = useRpc<LibraryData>()
const path = ref('')
const kind = ref<string>(data.value.kinds[0]?.id ?? 'movie')
const kindLabel = (id: string) => data.value.kinds.find((k) => k.id === id)?.label ?? id
const error = ref('')
const saved = ref(false)
const naming = ref({ ...data.value.naming })
watch(
  () => data.value.naming,
  (n) => (naming.value = { ...n }),
  { deep: true },
)

async function add() {
  error.value = ''
  try {
    await data.value.addRootFolder(path.value.trim(), kind.value as never)
    path.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function save() {
  await data.value.saveNaming(naming.value)
  saved.value = true
  setTimeout(() => (saved.value = false), 2000)
}
</script>

<style scoped>
.path {
  flex: 1;
  max-width: 420px;
}
.add {
  margin-top: 12px;
}
.save {
  margin-top: 8px;
}
</style>
