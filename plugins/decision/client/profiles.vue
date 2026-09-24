<template>
  <section class="dc">
    <h1>Quality profiles</h1>
    <div class="list">
      <nav>
        <a
          v-for="p in data.profiles"
          :key="p.id"
          :class="{ active: draft?.id === p.id }"
          @click="edit(p)"
          >{{ p.name }}</a
        >
        <button style="margin-top: 8px" @click="create">New profile</button>
      </nav>
      <div v-if="draft" class="mp-card">
        <div class="dc-row">
          <label>Name</label><input v-model="draft.name" data-testid="profile-name" />
          <label>Upgrades</label><input v-model="draft.upgradesAllowed" type="checkbox" />
        </div>
        <div class="dc-row">
          <label>Cutoff</label>
          <select v-model="draft.cutoff">
            <option
              v-for="item in draft.items.filter((i) => i.allowed)"
              :key="key(item)"
              :value="key(item)"
            >
              {{ label(item) }}
            </option>
          </select>
          <label>Min format score</label
          ><input v-model.number="draft.minFormatScore" type="number" style="width: 80px" />
          <label>Cutoff format score</label
          ><input v-model.number="draft.cutoffFormatScore" type="number" style="width: 80px" />
        </div>
        <div class="dc-row">
          <label>Languages</label
          ><input v-model="languages" placeholder="en (empty = any)" style="width: 120px" />
          <label>Min seeders</label
          ><input v-model.number="draft.minSeeders" type="number" style="width: 70px" />
          <label>Min usenet age (min)</label
          ><input v-model.number="draft.minAgeMinutes" type="number" style="width: 70px" />
        </div>

        <h3>Qualities <span class="muted">(best at the top)</span></h3>
        <table>
          <tbody>
            <tr v-for="(item, i) in reversed" :key="key(item)">
              <td style="width: 30px"><input v-model="item.allowed" type="checkbox" /></td>
              <td>
                {{ label(item) }}
                <span v-if="'qualities' in item" class="muted"
                  >({{ item.qualities.map(qualityName).join(', ') }})</span
                >
              </td>
              <td style="width: 80px">
                <button :disabled="i === 0" @click="move(item, 1)">↑</button>
                <button :disabled="i === reversed.length - 1" @click="move(item, -1)">↓</button>
              </td>
            </tr>
          </tbody>
        </table>

        <h3>Custom format scores</h3>
        <p v-if="!data.formats.length" class="muted">No custom formats yet.</p>
        <div v-for="f in data.formats" :key="f.id" class="dc-row">
          <input v-model.number="scores[f.id]" type="number" style="width: 80px" />
          <span>{{ f.name }}</span>
        </div>

        <div class="dc-row">
          <button class="primary" data-testid="save-profile" @click="save">Save</button>
          <button v-if="draft.id" class="danger" @click="remove">Delete</button>
          <span v-if="message" class="muted">{{ message }}</span>
        </div>
      </div>
    </div>

    <h2>Size limits</h2>
    <p class="muted">
      Megabytes per minute of runtime. Releases outside these limits are rejected.
    </p>
    <table class="mp-card">
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
        <tr v-for="s in sizes" :key="s.quality">
          <td>{{ qualityName(s.quality) }}</td>
          <td><input v-model.number="s.min" type="number" style="width: 70px" /></td>
          <td><input v-model.number="s.preferred" type="number" style="width: 70px" /></td>
          <td><input v-model.number="s.max" type="number" style="width: 70px" /></td>
          <td>
            <button
              @click="data.saveSize({ ...s, preferred: s.preferred || null, max: s.max || null })"
            >
              Save
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>Required and ignored terms</h2>
    <p class="muted">Comma-separated words, or <code>/regex/</code>. Applies to every search.</p>
    <div v-for="r in restrictions" :key="r.id ?? 'new'" class="mp-card">
      <div class="dc-row">
        <label>Must contain one of</label><input v-model="r.requiredText" style="flex: 1" />
      </div>
      <div class="dc-row">
        <label>Must not contain</label><input v-model="r.ignoredText" style="flex: 1" />
      </div>
      <div class="dc-row">
        <button class="primary" @click="saveRestriction(r)">Save</button>
        <button v-if="r.id" class="danger" @click="data.deleteRestriction(r.id)">Delete</button>
      </div>
    </div>
    <button @click="restrictions.push({ requiredText: '', ignoredText: '' })">Add terms</button>
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

function create() {
  const any = data.value.profiles.find((p) => p.name === 'Any') ?? data.value.profiles[0]!
  const { id: _, ...rest } = clone(any)
  draft.value = { ...rest, name: 'New profile' }
  languages.value = rest.languages.join(', ')
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

if (data.value.profiles[0]) edit(data.value.profiles[0])

const sizes = ref(clone(data.value.sizes))
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
