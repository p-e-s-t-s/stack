<template>
  <section>
    <div class="mp-head"><h1>Video and audio tools</h1></div>
    <p class="mp-lead">
      Magpie uses <b>ffprobe</b> to read what is really inside your video files (resolution, audio
      and subtitle tracks), and <b>ffmpeg</b> for optional deeper checks. Install them on the
      server, then enter a name on the <code>PATH</code> or a full path.
    </p>
    <form class="mp-card" @submit.prevent="save">
      <div v-for="tool in tools" :key="tool" class="mp-field">
        <label>
          {{ tool }} executable
          <input v-model="draft[tool]" required :data-testid="tool" />
        </label>
        <span
          class="mp-badge"
          :class="data.status[tool].ok ? 'ok' : 'bad'"
          :data-testid="`${tool}-status`"
        >
          {{
            data.status[tool].ok
              ? `Available${data.status[tool].version ? ` (${data.status[tool].version})` : ''}`
              : data.status[tool].detail
          }}
        </span>
      </div>
      <div class="mp-row">
        <button class="primary" :disabled="busy">Save</button>
        <button type="button" :disabled="busy" @click="test">Test</button>
      </div>
      <p v-if="message" :class="bad ? 'mp-error' : 'mp-muted'">{{ message }}</p>
    </form>
  </section>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { MediaToolsData } from '../src/console'

const data = useRpc<MediaToolsData>()
const tools = ['ffprobe', 'ffmpeg'] as const
const draft = ref({ ...data.value.settings })
const busy = ref(false)
const message = ref('')
const bad = ref(false)

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  bad.value = false
  message.value = ''
  try {
    await fn()
  } catch (error) {
    message.value = String(error)
    bad.value = true
  } finally {
    busy.value = false
  }
}
const save = () => run(() => data.value.save({ ...draft.value }))
const test = () => run(() => data.value.test())
</script>
