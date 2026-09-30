<template>
  <div v-if="result" class="mp-small" data-testid="check-badge">
    <span class="mp-badge" :class="BADGE[result.outcome]">{{ label }}</span>
    <details v-if="result.findings.length">
      <summary class="mp-muted">Details</summary>
      <div
        v-for="(f, i) in result.findings"
        :key="i"
        :class="f.severity === 'reject' ? 'mp-error' : ''"
      >
        {{ f.reason }}
      </div>
    </details>
    <div v-if="actual" class="mp-muted" data-testid="actual">Actual: {{ actual }}</div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { VerifyData } from '../src/console'
import type { Result } from '../src/schema'
import { summarize } from './describe'

const props = defineProps<{ grab?: { id: number } }>()
const data = useRpc<VerifyData>()
const result = ref<Result | null>(null)

watch(
  () => [props.grab?.id, data.value.version],
  async () => {
    result.value = props.grab ? await data.value.forGrab(props.grab.id) : null
  },
  { immediate: true },
)

const BADGE = { passed: 'ok', warned: 'warn', rejected: 'bad' }
const label = computed(() => {
  const r = result.value
  if (!r) return ''
  if (r.outcome === 'passed') return 'Checks passed'
  const n = r.findings.length
  return r.outcome === 'rejected' ? 'Rejected' : `${n} warning${n === 1 ? '' : 's'}`
})
// what the files really are, next to the release name
const actual = computed(() => {
  const facts = result.value?.files[0]?.facts
  return facts ? summarize(facts) : ''
})
</script>
