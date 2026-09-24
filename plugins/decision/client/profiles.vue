<template>
  <section class="dc">
    <div class="mp-head">
      <h1>Quality profiles</h1>
      <button @click="create">New profile</button>
    </div>
    <p class="mp-lead">
      A profile decides which releases Magpie accepts for a movie, which one it prefers, and when it
      stops upgrading.
    </p>
    <div v-if="data.families.length > 1" class="mp-row families">
      <button
        v-for="f in data.families"
        :key="f.id"
        class="small"
        :class="{ primary: f.id === familyId }"
        @click="pickFamily(f.id)"
      >
        {{ f.label }}
      </button>
    </div>
    <div class="mp-tabs">
      <button
        v-for="p in familyProfiles"
        :key="p.id"
        :class="{ active: draft?.id === p.id }"
        @click="edit(p)"
      >
        {{ p.name }}
      </button>
      <button v-if="draft && !draft.id" class="active">New profile</button>
    </div>

    <div v-if="draft" class="profile">
      <div class="mp-card">
        <div class="mp-field">
          <label for="p-name">Name</label>
          <input id="p-name" v-model="draft.name" data-testid="profile-name" />
        </div>
        <div class="mp-field">
          <label for="p-upgrades">Upgrade files</label>
          <div><input id="p-upgrades" v-model="draft.upgradesAllowed" type="checkbox" /></div>
          <span class="mp-help">Replace a downloaded file when a better release appears.</span>
        </div>
        <div class="mp-field">
          <label for="p-cutoff">Stop upgrading at</label>
          <select id="p-cutoff" v-model="draft.cutoff">
            <option
              v-for="item in draft.items.filter((i) => i.allowed)"
              :key="key(item)"
              :value="key(item)"
            >
              {{ label(item) }}
            </option>
          </select>
        </div>
        <div class="mp-field">
          <label for="p-languages">Languages</label>
          <input id="p-languages" v-model="languages" placeholder="Any" />
          <span class="mp-help">Language codes, comma separated, e.g. <code>en</code>.</span>
        </div>
        <details class="more">
          <summary>More options</summary>
          <div class="mp-field">
            <label for="p-min-score">Minimum format score</label>
            <input id="p-min-score" v-model.number="draft.minFormatScore" type="number" />
          </div>
          <div class="mp-field">
            <label for="p-cutoff-score">Stop upgrading at score</label>
            <input id="p-cutoff-score" v-model.number="draft.cutoffFormatScore" type="number" />
          </div>
          <div class="mp-field">
            <label for="p-seeders">Minimum seeders</label>
            <input id="p-seeders" v-model.number="draft.minSeeders" type="number" />
          </div>
          <div class="mp-field">
            <label for="p-age">Minimum usenet age</label>
            <input id="p-age" v-model.number="draft.minAgeMinutes" type="number" />
            <span class="mp-help">Minutes.</span>
          </div>
        </details>
      </div>

      <h2>Qualities</h2>
      <p class="mp-lead">Tick the qualities to accept. Higher in the list is preferred.</p>
      <table class="mp-table qualities">
        <tbody>
          <tr v-for="(item, i) in reversed" :key="key(item)" :class="{ off: !item.allowed }">
            <td style="width: 36px"><input v-model="item.allowed" type="checkbox" /></td>
            <td>
              {{ label(item) }}
              <span v-if="'qualities' in item" class="mp-muted mp-small">{{
                item.qualities.map(qualityName).join(', ')
              }}</span>
            </td>
            <td class="actions">
              <button class="small" :disabled="i === 0" title="Prefer" @click="move(item, 1)">
                ↑
              </button>
              <button
                class="small"
                :disabled="i === reversed.length - 1"
                title="Prefer less"
                @click="move(item, -1)"
              >
                ↓
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="data.formats.length">
        <h2>Custom format scores</h2>
        <p class="mp-lead">Releases matching a format get its score; higher scores win.</p>
        <table class="mp-table">
          <tbody>
            <tr v-for="f in data.formats" :key="f.id">
              <td>{{ f.name }}</td>
              <td class="actions">
                <input v-model.number="scores[f.id]" type="number" class="score" />
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <div class="mp-row save">
        <button class="primary" data-testid="save-profile" @click="save">Save profile</button>
        <button v-if="draft.id" class="danger" @click="remove">Delete</button>
        <span v-if="message" class="mp-muted">{{ message }}</span>
      </div>
    </div>

    <details class="global">
      <summary>Size limits and required terms (all profiles)</summary>

      <h2>Size limits</h2>
      <p class="mp-lead">
        {{
          family?.sizeRule === 'total'
            ? 'Megabytes per release.'
            : 'Megabytes per minute of runtime.'
        }}
        Releases outside these are rejected.
      </p>
      <table class="mp-table">
        <thead>
          <tr>
            <th>Quality</th>
            <th>Min</th>
            <th>Preferred</th>
            <th>Max</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in familySizes" :key="s.quality">
            <td>{{ qualityName(s.quality) }}</td>
            <td><input v-model.number="s.min" type="number" class="score" /></td>
            <td><input v-model.number="s.preferred" type="number" class="score" /></td>
            <td><input v-model.number="s.max" type="number" class="score" /></td>
            <td class="actions">
              <button
                class="small"
                @click="data.saveSize({ ...s, preferred: s.preferred || null, max: s.max || null })"
              >
                Save
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Required and ignored terms</h2>
      <p class="mp-lead">Comma-separated words, or <code>/regex/</code>.</p>
      <div v-for="r in restrictions" :key="r.id ?? 'new'" class="mp-card">
        <div class="mp-field">
          <label>Must contain one of</label><input v-model="r.requiredText" />
        </div>
        <div class="mp-field"><label>Must not contain</label><input v-model="r.ignoredText" /></div>
        <div class="mp-row">
          <button class="primary small" @click="saveRestriction(r)">Save</button>
          <button v-if="r.id" class="small danger" @click="data.deleteRestriction(r.id)">
            Delete
          </button>
        </div>
      </div>
      <button @click="restrictions.push({ requiredText: '', ignoredText: '' })">Add terms</button>
    </details>
  </section>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { DecisionData } from '../src/console'
import type { Profile, ProfileItem } from '../src/schema'

const data = useRpc<DecisionData>()
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const qualityName = (id: string) => data.value.qualities.find((q) => q.id === id)?.name ?? id
const key = (item: ProfileItem) => ('quality' in item ? item.quality : item.name)
const label = (item: ProfileItem) => ('quality' in item ? qualityName(item.quality) : item.name)

const draft = ref<(Omit<Profile, 'id'> & { id?: number }) | undefined>()
const scores = reactive<Record<number, number>>({})
const languages = ref('')
const message = ref('')
const reversed = computed(() => [...(draft.value?.items ?? [])].reverse())

function edit(p: Profile) {
  draft.value = clone(p)
  languages.value = p.languages.join(', ')
  for (const k of Object.keys(scores)) delete scores[+k]
  Object.assign(scores, data.value.scores[p.id] ?? {})
  message.value = ''
}

// profiles belong to a quality family (video, audio…); the page shows one family at a time
const familyId = ref(data.value.families[0]?.id ?? 'video')
const family = computed(() => data.value.families.find((f) => f.id === familyId.value))
const familyProfiles = computed(() =>
  data.value.profiles.filter((p) => p.family === familyId.value),
)
const familySizes = computed(() =>
  sizes.value.filter((s) => family.value?.qualities.some((q) => q.id === s.quality)),
)

function pickFamily(id: string) {
  familyId.value = id
  const first = familyProfiles.value[0]
  if (first) edit(first)
  else create()
}

function create() {
  const template = familyProfiles.value.find((p) => p.name === 'Any') ?? familyProfiles.value[0]
  if (template) {
    const { id: _, ...rest } = clone(template)
    draft.value = { ...rest, name: 'New profile' }
  } else {
    // a family without profiles: every quality allowed, the best as cutoff
    const qualities = family.value?.qualities ?? []
    draft.value = {
      name: 'New profile',
      family: familyId.value,
      items: qualities.map((q) => ({ quality: q.id, allowed: true })),
      cutoff: qualities.at(-1)?.id ?? '',
      minFormatScore: 0,
      cutoffFormatScore: 0,
      upgradesAllowed: true,
      languages: [],
      minSeeders: 1,
      minAgeMinutes: 0,
    }
  }
  languages.value = draft.value.languages.join(', ')
  for (const k of Object.keys(scores)) delete scores[+k]
}

function move(item: ProfileItem, direction: 1 | -1) {
  const items = draft.value!.items
  const i = items.indexOf(item)
  const j = i + direction
  if (j < 0 || j >= items.length) return
  ;[items[i], items[j]] = [items[j]!, items[i]!]
}

async function save() {
  const d = draft.value!
  d.languages = languages.value
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)
  const id = await data.value.saveProfile(d as Profile)
  for (const f of data.value.formats) await data.value.setScore(id, f.id, scores[f.id] || 0)
  d.id = id
  message.value = 'Saved.'
}

async function remove() {
  await data.value.deleteProfile(draft.value!.id!)
  draft.value = undefined
}

const sizes = ref(clone(data.value.sizes))
if (familyProfiles.value[0]) edit(familyProfiles.value[0])
type RestrictionDraft = { id?: number; requiredText: string; ignoredText: string }
const restrictions = ref<RestrictionDraft[]>([])
watch(
  () => [data.value.sizes, data.value.restrictions] as const,
  ([s, r]) => {
    sizes.value = clone(s)
    restrictions.value = r.map((x) => ({
      id: x.id,
      requiredText: x.required.join(', '),
      ignoredText: x.ignored.join(', '),
    }))
  },
  { immediate: true, deep: true },
)

const split = (text: string) =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
async function saveRestriction(r: RestrictionDraft) {
  await data.value.saveRestriction({
    ...(r.id && { id: r.id }),
    required: split(r.requiredText),
    ignored: split(r.ignoredText),
  } as never)
}
</script>
