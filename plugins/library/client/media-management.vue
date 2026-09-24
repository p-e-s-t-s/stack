<template>
  <section class="lib">
    <h1>Media management</h1>

    <h2>Root folders</h2>
    <p class="muted">Where your library lives. Magpie creates one folder per movie inside.</p>
    <div class="mp-card">
      <table>
        <tbody>
          <tr v-for="f in data.rootFolders" :key="f.id">
            <td class="mono">{{ f.path }}</td>
            <td>{{ f.kind === 'movie' ? 'Movies' : 'Series' }}</td>
            <td style="width: 80px">
              <button @click="data.removeRootFolder(f.id)">Remove</button>
            </td>
          </tr>
          <tr v-if="!data.rootFolders.length">
            <td class="muted">No root folders yet.</td>
          </tr>
        </tbody>
      </table>
      <div class="row">
        <input
          v-model="path"
          placeholder="/data/media/movies"
          style="flex: 1"
          data-testid="root-path"
        />
        <select v-model="kind">
          <option value="movie">Movies</option>
          <option value="series">Series</option>
        </select>
        <button class="primary" data-testid="add-root" @click="add">Add</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <h2>File naming</h2>
    <div class="mp-card">
      <div class="row">
        <label>Movie folder</label><input v-model="naming.movieFolder" style="flex: 1" />
      </div>
      <div class="row">
        <label>Movie file</label><input v-model="naming.movieFile" style="flex: 1" />
      </div>
      <p class="muted">
        Tokens: <code>{Title}</code> <code>{Year}</code> <code>{Quality}</code>
        <code>{Edition}</code> <code>{Group}</code> <code>{Resolution}</code> <code>{Source}</code>.
        The file extension is added automatically.
      </p>
    </div>

    <h2>File handling</h2>
    <div class="mp-card">
      <div class="row">
        <label
          ><input v-model="naming.useHardlinks" type="checkbox" /> Use hardlinks for torrents</label
        >
        <span class="muted"
          >Needs the download folder and library on the same filesystem; otherwise Magpie
          copies.</span
        >
      </div>
      <div class="row">
        <label>Recycle bin</label
        ><input
          v-model="naming.recycleBin"
          placeholder="empty = delete replaced files"
          style="flex: 1"
        />
      </div>
    </div>
    <div class="row">
      <button class="primary" @click="save">Save</button
      ><span v-if="saved" class="muted">Saved.</span>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { LibraryData } from '../src/console'

const data = useRpc<LibraryData>()
const path = ref('')
const kind = ref<'movie' | 'series'>('movie')
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
    await data.value.addRootFolder(path.value.trim(), kind.value)
    path.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function save() {
  await data.value.saveNaming(naming.value)
  saved.value = true
}
</script>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
  flex-wrap: wrap;
}
.row label {
  color: var(--mp-muted);
  font-size: 13px;
  min-width: 110px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.muted {
  color: var(--mp-muted);
  font-size: 13px;
}
.error {
  color: #d33;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--mp-border);
}
input,
select,
button {
  font: inherit;
  color: var(--mp-text);
  background: var(--mp-surface);
  border: 1px solid var(--mp-border);
  border-radius: 6px;
  padding: 6px 8px;
}
button {
  cursor: pointer;
}
button.primary {
  background: var(--mp-accent);
  color: #fff;
  border-color: var(--mp-accent);
}
</style>
