<template>
  <section class="dc">
    <h1>Custom formats</h1>
    <p class="muted">
      A format matches when all <b>required</b> conditions match and at least one of the others
      does. Profiles give each format a score.
    </p>
    <div class="list">
      <nav>
        <a
          v-for="f in data.formats"
          :key="f.id"
          :class="{ active: draft?.id === f.id }"
          @click="edit(f)"
          >{{ f.name }}</a
        >
        <button style="margin-top: 8px" data-testid="new-format" @click="create">New format</button>
      </nav>
      <div v-if="draft" class="mp-card">
        <div class="dc-row">
          <label>Name</label><input v-model="draft.name" data-testid="format-name" />
          <label>Include in file name</label
          ><input v-model="draft.includeInFileName" type="checkbox" />
        </div>
        <table>
          <thead>
            <tr>
              <th>Condition</th>
              <th>Value</th>
              <th>Required</th>
              <th>Negate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in draft.conditions" :key="i">
              <td>
                <select v-model="c.type" @change="c.value = c.type === 'size' ? {} : ''">
                  <option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </td>
              <td>
                <template v-if="c.type === 'size'">
                  <input
                    v-model.number="(c.value as any).min"
                    type="number"
                    placeholder="min GB"
                    style="width: 80px"
                  />
                  <input
                    v-model.number="(c.value as any).max"
                    type="number"
                    placeholder="max GB"
                    style="width: 80px"
                  />
                </template>
                <select v-else-if="options[c.type]" v-model="c.value">
                  <option v-for="o in options[c.type]" :key="o" :value="o">{{ o }}</option>
                </select>
                <input
                  v-else
                  v-model="c.value"
                  placeholder="regular expression"
                  data-testid="condition-value"
                />
              </td>
              <td><input v-model="c.required" type="checkbox" /></td>
              <td><input v-model="c.negate" type="checkbox" /></td>
              <td><button @click="draft.conditions.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <div class="dc-row">
          <button
            data-testid="add-condition"
            @click="
              draft.conditions.push({ type: 'title', value: '', required: false, negate: false })
            "
          >
            Add condition
          </button>
        </div>

        <h3>Try it</h3>
        <div class="dc-row">
          <input
            v-model="sample"
            style="flex: 1"
            placeholder="Release name"
            data-testid="format-sample"
          />
          <span
            v-if="matches !== undefined"
            :class="matches ? 'ok' : 'no'"
            data-testid="format-result"
            >{{ matches ? 'Matches' : 'No match' }}</span
          >
        </div>

        <div class="dc-row">
          <button class="primary" data-testid="save-format" @click="save">Save</button>
          <button v-if="draft.id" class="danger" @click="remove">Delete</button>
          <span v-if="message" class="muted">{{ message }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { DecisionData } from '../src/console'
import { formatMatches } from '../src/formats'
import type { CustomFormat } from '../src/schema'

const data = useRpc<DecisionData>()
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

const types = [
  { id: 'title', name: 'Release name' },
  { id: 'group', name: 'Release group' },
  { id: 'edition', name: 'Edition' },
  { id: 'source', name: 'Source' },
  { id: 'resolution', name: 'Resolution' },
  { id: 'modifier', name: 'Modifier' },
  { id: 'hdr', name: 'HDR format' },
  { id: 'videoCodec', name: 'Video codec' },
  { id: 'audioCodec', name: 'Audio codec' },
  { id: 'language', name: 'Language' },
  { id: 'streamingService', name: 'Streaming service' },
  { id: 'size', name: 'Size' },
  { id: 'indexerFlag', name: 'Indexer flag' },
]
const options: Record<string, string[]> = {
  source: ['cam', 'telesync', 'telecine', 'workprint', 'dvd', 'hdtv', 'webrip', 'webdl', 'bluray'],
  resolution: ['480p', '576p', '720p', '1080p', '2160p'],
  modifier: ['remux', 'brdisk', 'rawhd', 'regional', 'screener'],
  hdr: ['dv', 'hdr10plus', 'hdr10', 'hlg'],
  videoCodec: ['x264', 'x265', 'av1', 'vc1', 'mpeg2', 'xvid'],
  audioCodec: [
    'truehd',
    'dtsx',
    'dtshdma',
    'dtshd',
    'dts',
    'ddp',
    'dd',
    'aac',
    'flac',
    'opus',
    'mp3',
    'pcm',
  ],
  indexerFlag: ['freeleech', 'halfleech', 'internal', 'scene'],
}

const draft = ref<(Omit<CustomFormat, 'id'> & { id?: number }) | undefined>()
const message = ref('')
const sample = ref('')
const matches = ref<boolean | undefined>()

function edit(f: CustomFormat) {
  draft.value = clone(f)
  message.value = ''
}
function create() {
  draft.value = { name: 'New format', conditions: [], includeInFileName: false }
  message.value = ''
}

// the parser runs on the server; matching runs here so the result updates while typing
watch(
  [sample, draft],
  async () => {
    if (!sample.value.trim() || !draft.value) return (matches.value = undefined)
    const [result] = await data.value.test([sample.value])
    if (!result) return
    matches.value = formatMatches(draft.value, {
      parsed: result.parsed,
      info: { title: sample.value },
    })
  },
  { deep: true },
)

async function save() {
  const id = await data.value.saveFormat(draft.value as CustomFormat)
  draft.value!.id = id
  message.value = 'Saved. Give it a score in a quality profile.'
}
async function remove() {
  await data.value.deleteFormat(draft.value!.id!)
  draft.value = undefined
}
if (data.value.formats[0]) edit(data.value.formats[0])
</script>
