<template>
  <section class="lib">
    <div class="mp-head"><h1>Media management</h1></div>

    <h2>Root folders</h2>
    <p class="mp-lead">
      Choose one library location. Magpie creates a folder inside it for each media type.
    </p>
    <form class="mp-row add" @submit.prevent="saveRoot">
      <input
        v-model="path"
        placeholder="/data/media"
        class="path"
        data-testid="root-path"
      />
      <button class="primary" type="submit" :disabled="!path.trim()" data-testid="save-root">
        Save location
      </button>
      <span v-if="saved === 'root'" class="mp-muted">Saved.</span>
    </form>
    <table v-if="data.rootFolders.length" class="mp-table folders">
      <tbody>
        <tr v-for="f in data.rootFolders" :key="f.id">
          <td class="mp-muted">{{ kindLabel(f.kind) }}</td>
          <td class="mono">{{ f.path }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="error" class="mp-error">{{ error }}</p>

    <template v-for="k in data.kinds" :key="k.id">
      <template v-if="k.naming && naming[k.id]">
        <h2>{{ k.label }} naming</h2>
        <div class="mp-card">
          <div v-for="t in k.naming.templates" :key="t.key" class="mp-field">
            <label :for="`${k.id}-${t.key}`">{{ t.label }}</label>
            <input
              :id="`${k.id}-${t.key}`"
              v-model="naming[k.id]![t.key]"
              :data-testid="`naming-${k.id}-${t.key}`"
            />
            <span v-if="t.help" class="mp-help">{{ t.help }}</span>
          </div>
          <p class="mp-muted mp-small tokens">
            Tokens: <code v-for="token in k.naming.tokens" :key="token">{{ braces(token) }}</code>
          </p>
          <div class="mp-row">
            <button class="primary" @click="saveNaming(k.id)">Save</button>
            <span v-if="saved === k.id" class="mp-muted">Saved.</span>
          </div>
        </div>
      </template>
    </template>

    <h2>Files</h2>
    <div class="mp-card">
      <div class="mp-field">
        <label for="hardlinks">Use hardlinks</label>
        <div><input id="hardlinks" v-model="files.useHardlinks" type="checkbox" /></div>
        <span class="mp-help">
          Torrents keep seeding without using extra space. Needs downloads and library on the same
          drive; otherwise Magpie copies.
        </span>
      </div>
      <div class="mp-field">
        <label for="recycle">Recycle bin</label>
        <input id="recycle" v-model="files.recycleBin" placeholder="Leave empty to delete" />
        <span class="mp-help">
          Replaced files are moved here instead of deleted. Leave empty and Magpie keeps them in its
          own trash for the undo period below.
        </span>
      </div>
      <div class="mp-field">
        <label for="undo-days">Keep imports undoable for (days)</label>
        <input id="undo-days" v-model.number="files.undoRetentionDays" type="number" min="0" />
        <span class="mp-help">
          Imports, replacements and renames can be undone until then. 0 turns undo off, and replaced
          files are deleted straight away.
        </span>
      </div>
      <div class="mp-field">
        <label for="undo-gb">Trash size limit (GB)</label>
        <input id="undo-gb" v-model.number="files.undoMaxGb" type="number" min="0" />
        <span class="mp-help">
          Replaced files kept in Magpie's trash use disk space. The oldest are purged first, and
          their imports can no longer be undone. 0 for no limit.
        </span>
      </div>
      <div class="mp-row save">
        <button class="primary" @click="saveFiles">Save</button>
        <span v-if="saved === 'files'" class="mp-muted">Saved.</span>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { LibraryData } from '../src/console'

const data = useRpc<LibraryData>()
const path = ref(data.value.libraryRoot)
const kindLabel = (id: string) => data.value.kinds.find((k) => k.id === id)?.label ?? id
const error = ref('')
const saved = ref<string>()
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const naming = ref(clone(data.value.naming))
const files = ref(clone(data.value.files))
watch(
  () => [data.value.naming, data.value.files, data.value.libraryRoot] as const,
  ([n, f, root]) => {
    naming.value = clone(n)
    files.value = clone(f)
    path.value = root
  },
  { deep: true },
)

/** `Title` → `{Title}` (written out, since `}}` would end a template expression). */
const braces = (token: string) => '{' + token + '}'

function flash(what: string) {
  saved.value = what
  setTimeout(() => (saved.value = undefined), 2000)
}

async function saveRoot() {
  error.value = ''
  try {
    await data.value.saveLibraryRoot(path.value.trim())
    flash('root')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function saveNaming(kind: string) {
  await data.value.saveNaming(kind as never, naming.value[kind]!)
  flash(kind)
}

async function saveFiles() {
  await data.value.saveFiles(files.value)
  flash('files')
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
.folders {
  margin-top: 12px;
}
.save {
  margin-top: 8px;
}
.tokens code {
  margin-right: 6px;
}
</style>
