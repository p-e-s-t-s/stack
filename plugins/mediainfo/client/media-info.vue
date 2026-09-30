<template>
  <div v-if="files.length" data-testid="media-info">
    <details class="mp-section" :open="files.length === 1">
      <summary>Media info</summary>
      <p v-if="!data.ffprobe.ok" class="mp-muted mp-small" data-testid="no-ffprobe">
        ffprobe is {{ data.ffprobe.detail }}. Set it up in
        <NavLink to="/settings/media-tools">Settings → Media tools</NavLink> to see what is inside
        your files.
      </p>
      <div v-for="f in files" :key="f.fileId" class="mp-card" data-testid="media-info-file">
        <div class="mp-row">
          <strong class="mono">{{ f.path }}</strong>
          <span v-for="e in f.episodes" :key="`${e.season}x${e.number}`" class="mp-badge">
            S{{ pad(e.season) }}E{{ pad(e.number) }}
          </span>
          <span v-if="f.facts?.duration" class="mp-muted">{{ duration(f.facts.duration) }}</span>
          <span v-if="f.facts?.container" class="mp-muted">{{ f.facts.container }}</span>
          <button class="small" :disabled="!data.ffprobe.ok" @click="data.reprobe(f.fileId)">
            Probe again
          </button>
        </div>
        <p v-if="f.error" class="mp-error mp-small" data-testid="probe-error">
          Could not read this file: {{ f.error }}
        </p>
        <p v-else-if="!f.facts" class="mp-muted mp-small">Not probed yet.</p>
        <template v-else>
          <p v-if="mismatch(f)" class="mp-small" data-testid="mismatch">
            <span class="mp-badge warn">Label mismatch</span>
            The release said {{ mismatch(f)!.claimed }}, the file is {{ mismatch(f)!.actual }}.
          </p>
          <table class="mp-table">
            <tbody>
              <tr v-if="f.facts.video">
                <th>Video</th>
                <td data-testid="video">{{ videoSummary(f.facts.video) }}</td>
              </tr>
              <tr v-if="f.facts.audio.length">
                <th>Audio</th>
                <td>
                  <div v-for="a in f.facts.audio" :key="a.index" data-testid="audio">
                    {{ audioSummary(a) }}
                  </div>
                </td>
              </tr>
              <tr v-if="f.facts.subtitles.length">
                <th>Subtitles</th>
                <td>
                  <div v-for="s in f.facts.subtitles" :key="s.index" data-testid="subtitle">
                    {{ subtitleSummary(s) }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </details>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import NavLink from '@magpiejs/console-kit/NavLink.vue'
import type { MediaInfoData, MediaInfoView } from '../src/console'
import { audioSummary, duration, labelMismatch, subtitleSummary, videoSummary } from './describe'

// `movie` or `series`, from the slot that shows this panel
const props = defineProps<{ movie?: { id: number }; series?: { id: number } }>()
const data = useRpc<MediaInfoData>()
const files = ref<MediaInfoView[]>([])
const pad = (n: number) => String(n).padStart(2, '0')
const mismatch = (f: MediaInfoView) => labelMismatch(f.quality, f.facts?.video)

async function load() {
  const id = (props.movie ?? props.series)?.id
  if (id !== undefined) files.value = await data.value.forMedia(id)
}
watch(() => [props.movie?.id, props.series?.id, data.value.version], load, { immediate: true })
</script>
