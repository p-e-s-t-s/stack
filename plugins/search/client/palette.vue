<template>
  <div class="mp-palette">
    <button type="button" class="mp-palette-open" data-testid="palette-open" @click="show">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <span>Search</span>
      <kbd>Ctrl K</kbd>
    </button>
    <Teleport to="body">
      <div v-if="open" class="mp-palette-back" @mousedown.self="close">
        <div class="mp-palette-box" role="dialog" aria-label="Search" data-testid="palette">
          <input
            ref="input"
            v-model="query"
            class="mp-palette-input"
            placeholder="Search your library"
            autocomplete="off"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="go(hits[active])"
            @keydown.esc="close"
          />
          <ul v-if="hits.length" class="mp-palette-list">
            <li
              v-for="(h, i) in hits"
              :key="h.id"
              :class="{ active: i === active }"
              data-testid="palette-hit"
              @mouseenter="active = i"
              @click="go(h)"
            >
              <span
                >{{ h.title }}<span v-if="h.year" class="mp-muted"> ({{ h.year }})</span></span
              >
              <span class="mp-muted mp-small">{{ h.kindLabel }}</span>
            </li>
          </ul>
          <p v-else-if="query.trim() && !busy" class="mp-empty">Nothing found.</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { SearchHit } from '../src'
import type { SearchData } from '../src/console'

const data = useRpc<SearchData>()
const router = useRouter()
const open = ref(false)
const query = ref('')
const hits = ref<SearchHit[]>([])
const active = ref(0)
const busy = ref(false)
const input = ref<HTMLInputElement>()

function show() {
  open.value = true
  query.value = ''
  hits.value = []
  void nextTick(() => input.value?.focus())
}
const close = () => (open.value = false)

// look up after a short pause; ignore answers to an older query
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
watch(query, (q) => {
  clearTimeout(timer)
  if (!q.trim()) {
    hits.value = []
    return
  }
  timer = setTimeout(async () => {
    const mine = ++seq
    busy.value = true
    try {
      const found = await data.value.find(q)
      if (mine === seq) {
        hits.value = found
        active.value = 0
      }
    } finally {
      if (mine === seq) busy.value = false
    }
  }, 150)
})

function move(step: number) {
  if (hits.value.length)
    active.value = (active.value + step + hits.value.length) % hits.value.length
}
function go(hit?: SearchHit) {
  if (!hit) return
  close()
  void router.push(hit.path)
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (open.value) close()
    else show()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style>
.mp-palette-open {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.mp-palette-open kbd {
  font-size: 0.7rem;
  opacity: 0.6;
}
.mp-palette-back {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #0008;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 1rem 1rem;
}
.mp-palette-box {
  width: min(36rem, 100%);
  background: var(--mp-surface, #1e1e1e);
  color: inherit;
  border: 1px solid var(--mp-border, #8884);
  border-radius: 8px;
  padding: 0.5rem;
}
.mp-palette-input {
  width: 100%;
  box-sizing: border-box;
  font-size: 1rem;
  padding: 0.6rem;
}
.mp-palette-list {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  max-height: 50vh;
  overflow: auto;
}
.mp-palette-list li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
}
.mp-palette-list li.active {
  background: var(--mp-accent, #4f8cff);
  color: #fff;
}
.mp-palette-list li.active .mp-muted {
  color: inherit;
  opacity: 0.8;
}
@media (max-width: 600px) {
  .mp-palette-open span,
  .mp-palette-open kbd {
    display: none;
  }
}
</style>
