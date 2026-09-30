<template>
  <section>
    <div class="mp-head"><h1>Import checks</h1></div>
    <p class="mp-lead">
      Before a finished download enters your library, Magpie looks inside it. A download that fails
      a <b>reject</b> check is deleted, the release is blocklisted, and Magpie searches for the next
      best one. <b>Warn</b> only records a finding. Releases you grabbed yourself are never
      rejected, only warned about.
    </p>
    <p v-if="!data.tools.ffprobe" class="mp-muted mp-small" data-testid="no-ffprobe">
      ffprobe is not available, so the checks marked “needs ffprobe” are skipped. Set it up in
      <NavLink to="/settings/media-tools">Settings → Media tools</NavLink>.
    </p>

    <form class="mp-card" @submit.prevent="save">
      <table class="mp-table" data-testid="checks">
        <thead>
          <tr>
            <th>Check</th>
            <th style="width: 220px">When it finds something</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in data.checks" :key="c.name">
            <td>
              <strong>{{ c.label }}</strong>
              <span v-if="c.needsProbe" class="mp-muted mp-small"> · needs ffprobe</span>
              <div class="mp-muted mp-small">{{ c.description }}</div>
            </td>
            <td>
              <select v-model="modes[c.name]" :data-testid="`mode-${c.name}`">
                <option value="off">Off</option>
                <option value="warn">Warn</option>
                <option value="reject">Reject</option>
              </select>
              <span v-if="c.name === 'decode' && !data.tools.ffmpeg" class="mp-muted mp-small">
                ffmpeg missing
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="mp-field">
        <label>
          Runtime tolerance (%)
          <input
            v-model.number="tolerance"
            type="number"
            min="1"
            max="99"
            data-testid="tolerance"
          />
        </label>
        <span class="mp-muted mp-small">
          How far a movie's length may be from its metadata before the runtime check fires.
        </span>
      </div>
      <div class="mp-row">
        <button class="primary" :disabled="busy">Save</button>
        <span v-if="saved" class="mp-muted" data-testid="saved">Saved</span>
      </div>
      <p v-if="error" class="mp-error">{{ error }}</p>
    </form>

    <h2>Try a file</h2>
    <p class="mp-lead">
      Runs the checks on a file or folder in a library folder or a recent download. Nothing is
      recorded or deleted. The release name, if you give one, is what the file is judged against.
    </p>
    <form class="mp-card" @submit.prevent="test">
      <div class="mp-field">
        <label>Path <input v-model="path" required data-testid="test-path" /></label>
      </div>
      <div class="mp-field">
        <label>
          Release name (optional)
          <input v-model="release" placeholder="Movie.2020.1080p.BluRay.x264-GRP" />
        </label>
      </div>
      <button :disabled="testing">Check</button>
      <p v-if="testError" class="mp-error" data-testid="test-error">{{ testError }}</p>
      <div v-if="verdict" data-testid="verdict">
        <span class="mp-badge" :class="BADGE[verdict.outcome]">{{ verdict.outcome }}</span>
        <div
          v-for="(f, i) in verdict.findings"
          :key="i"
          :class="f.severity === 'reject' ? 'mp-error' : ''"
        >
          {{ f.reason }}
        </div>
        <p v-if="!verdict.findings.length" class="mp-muted">Nothing found.</p>
      </div>
    </form>

    <h2>Recent checks</h2>
    <p v-if="!data.recent.length" class="mp-empty">No download has been checked yet.</p>
    <table v-else class="mp-table" data-testid="recent">
      <thead>
        <tr>
          <th>Release</th>
          <th>Result</th>
          <th>Findings</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in data.recent" :key="r.id">
          <td class="release">{{ r.title }}</td>
          <td>
            <span class="mp-badge" :class="BADGE[r.outcome]">{{ r.outcome }}</span>
          </td>
          <td>
            <div v-for="(f, i) in r.findings" :key="i" class="mp-small">{{ f.reason }}</div>
            <span v-if="!r.findings.length" class="mp-muted mp-small">
              {{ r.files[0]?.facts ? summarize(r.files[0].facts) : '' }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import NavLink from '@magpiejs/console-kit/NavLink.vue'
import type { Verdict } from '../src'
import type { VerifyData } from '../src/console'
import type { Mode } from '../src/schema'
import { summarize } from './describe'

const data = useRpc<VerifyData>()
const BADGE = { passed: 'ok', warned: 'warn', rejected: 'bad' }

const modes = ref<Record<string, Mode>>(
  Object.fromEntries(data.value.checks.map((c) => [c.name, c.mode])),
)
const tolerance = ref(Math.round(data.value.durationTolerance * 100))
const busy = ref(false)
const saved = ref(false)
const error = ref('')

async function save() {
  busy.value = true
  saved.value = false
  error.value = ''
  try {
    await data.value.save({ modes: { ...modes.value }, durationTolerance: tolerance.value / 100 })
    saved.value = true
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

const path = ref('')
const release = ref('')
const testing = ref(false)
const testError = ref('')
const verdict = ref<Verdict | null>(null)

async function test() {
  testing.value = true
  testError.value = ''
  verdict.value = null
  try {
    verdict.value = await data.value.test(path.value, release.value)
  } catch (e) {
    testError.value = String(e)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.release {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
}
</style>
