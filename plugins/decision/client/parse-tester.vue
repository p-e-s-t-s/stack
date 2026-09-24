<template>
  <section class="dc">
    <div class="mp-head"><h1>Release name tester</h1></div>
    <p class="mp-lead">
      Paste release names, one per line, to see how Magpie reads them and whether a profile would
      accept them.
    </p>
    <textarea
      v-model="input"
      rows="6"
      data-testid="names"
      placeholder="The.Matrix.1999.2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.Atmos.7.1-GROUP"
    />
    <div class="dc-row">
      <template v-if="data.families.length > 1">
        <label>Type</label>
        <select v-model="familyId" data-testid="family">
          <option v-for="f in data.families" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>
      </template>
      <label>Profile</label>
      <select v-model="profileId">
        <option :value="undefined">— none —</option>
        <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <label>Runtime (min)</label>
      <input v-model.number="runtime" type="number" style="width: 80px" />
      <label>Existing file</label>
      <select v-model="current">
        <option value="">— none —</option>
        <option v-for="q in family?.qualities ?? []" :key="q.id" :value="q.id">
          {{ q.name }}
        </option>
      </select>
      <button class="primary" data-testid="run" @click="run">Test</button>
    </div>

    <div v-for="(r, i) in results" :key="i" class="mp-card" data-testid="result">
      <div class="name">
        <span
          v-for="(part, j) in pieces(r.parsed)"
          :key="j"
          :class="part.field && 'sp-' + part.field"
          :title="part.field"
          >{{ part.text }}</span
        >
      </div>
      <div class="dc-row">
        <span v-if="r.decision" :class="r.decision.accepted ? 'ok' : 'no'">{{
          r.decision.accepted ? 'Accepted' : 'Rejected'
        }}</span>
        <span class="tag" v-if="r.decision">{{ qualityName(r.decision.quality) }}</span>
        <span class="tag" v-if="r.decision">score {{ r.decision.formatScore }}</span>
        <span class="tag" v-for="f in r.decision?.matchedFormats ?? []" :key="f">{{ f }}</span>
      </div>
      <ul v-if="r.decision?.rejections.length">
        <li v-for="x in r.decision.rejections" :key="x.rule">
          <b>{{ x.rule }}</b
          >: {{ x.reason }}
        </li>
      </ul>
      <table>
        <tbody>
          <tr v-for="[k, v] in fields(r.parsed)" :key="k">
            <th style="width: 160px">{{ k }}</th>
            <td>{{ v }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { DecisionData, TestResult } from '../src/console'

const data = useRpc<DecisionData>()
const input = ref('')
const familyId = ref(data.value.families[0]?.id ?? 'video')
const family = computed(() => data.value.families.find((f) => f.id === familyId.value))
const profiles = computed(() => data.value.profiles.filter((p) => p.family === familyId.value))
const profileId = ref<number | undefined>(profiles.value[0]?.id)
watch(familyId, () => {
  profileId.value = profiles.value[0]?.id
  current.value = ''
  results.value = []
})
const runtime = ref(120)
const current = ref('')
const results = ref<TestResult[]>([])

const qualityName = (id: string) => data.value.qualities.find((q) => q.id === id)?.name ?? id

async function run() {
  const revision = { version: 1, real: 0, proper: false, repack: false }
  results.value = await data.value.test(
    input.value.split('\n'),
    profileId.value,
    current.value ? { quality: current.value as never, formatScore: 0, revision } : undefined,
    runtime.value || undefined,
    familyId.value,
  )
}

function pieces(p: TestResult['parsed']) {
  const out: { text: string; field?: string }[] = []
  let at = 0
  for (const s of [...(p.spans ?? [])].sort((a, b) => a.start - b.start)) {
    if (s.start < at) continue
    if (s.start > at) out.push({ text: p.input.slice(at, s.start) })
    out.push({ text: s.text, field: s.field })
    at = s.end
  }
  out.push({ text: p.input.slice(at) })
  return out
}

/** Parsed fields to show. Video has a curated list; other families show what they return. */
function fields(parsed: TestResult['parsed']): [string, string][] {
  if (familyId.value !== 'video') {
    return Object.entries(parsed)
      .filter(([k, v]) => !['input', 'spans'].includes(k) && v !== undefined && v !== '')
      .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
  }
  const p = parsed as any
  const e = p.episodes
  const rows: [string, unknown][] = [
    ['title', p.title],
    ['year', p.year],
    ['kind', p.kind],
    [
      'episodes',
      e &&
        [
          e.season !== undefined && `season ${e.season}`,
          e.numbers.length && `episode ${e.numbers.join(', ')}`,
          e.absolute && `absolute ${e.absolute.join(', ')}`,
          e.airDate,
          e.seasons && `seasons ${e.seasons.join(', ')}`,
        ]
          .filter(Boolean)
          .join(' · '),
    ],
    ['resolution', p.resolution],
    ['source', [p.source, ...p.modifiers].filter(Boolean).join(' + ')],
    [
      'video',
      [
        p.video.codec,
        p.video.bitDepth && `${p.video.bitDepth}-bit`,
        ...p.video.hdr,
        p.video.threeD && '3D',
      ]
        .filter(Boolean)
        .join(', '),
    ],
    [
      'audio',
      [...p.audio.codecs, p.audio.channels, p.audio.atmos && 'Atmos'].filter(Boolean).join(', '),
    ],
    ['languages', p.languages.join(', ')],
    ['edition', p.edition],
    ['service', p.streamingService],
    [
      'revision',
      p.revision.version > 1 || p.revision.real
        ? `v${p.revision.version}${p.revision.real ? ` REAL×${p.revision.real}` : ''}`
        : '',
    ],
    ['group', p.group],
    [
      'flags',
      [...p.flags, p.hardcodedSubs && `hardcoded subs (${p.hardcodedSubs})`]
        .filter(Boolean)
        .join(', '),
    ],
  ]
  return rows
    .filter(([, v]) => v !== undefined && v !== '' && v !== 0 && v !== false)
    .map(([k, v]) => [k, String(v)])
}
</script>
