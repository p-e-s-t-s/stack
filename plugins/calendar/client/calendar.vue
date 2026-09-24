<template>
  <section class="cal">
    <div class="mp-head">
      <h1>Calendar</h1>
      <button class="small" @click="shift(-28)">← Earlier</button>
      <button class="small" :disabled="offset === 0" @click="offset = 0">Today</button>
      <button class="small" @click="shift(28)">Later →</button>
    </div>
    <p class="mp-lead">{{ label }}</p>

    <p v-if="loading && !days.length" class="mp-muted">Loading…</p>
    <p v-else-if="!days.length" class="mp-empty">Nothing airs or releases in these weeks.</p>
    <div v-for="day in days" :key="day.date" class="day" :class="{ today: day.date === today }">
      <div class="date">
        <div class="weekday">{{ weekday(day.date) }}</div>
        <div class="num">{{ day.date.slice(8) }}</div>
        <div class="month mp-muted">{{ month(day.date) }}</div>
      </div>
      <div class="items">
        <a
          v-for="e in day.entries"
          :key="e.uid"
          class="item"
          :href="link(e)"
          data-testid="calendar-entry"
          @click.prevent="router.push(link(e))"
        >
          <span class="dot" :class="e.state" />
          <span class="what">
            <strong>{{ e.title }}</strong>
            <span class="mp-muted sub">{{ e.subtitle }}</span>
          </span>
          <span class="mp-badge" :class="BADGES[e.state]">{{ e.quality ?? LABELS[e.state] }}</span>
        </a>
      </div>
    </div>

    <details class="subscribe">
      <summary>Subscribe in your calendar app</summary>
      <p class="mp-muted">
        Add this address as a calendar subscription (iCal). Replace <code>YOUR_KEY</code> with an
        API key from
        <a href="/settings/general" @click.prevent="router.push('/settings/general')"
          >Settings → General</a
        >.
      </p>
      <code class="url">{{ feedUrl }}</code>
    </details>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRouter, useRpc } from '@cordisjs/client'
import type { CalendarEntry } from '../src/index'
import type { CalendarData } from '../src/console'

const LABELS: Record<CalendarEntry['state'], string> = {
  downloaded: 'Downloaded',
  missing: 'Missing',
  upcoming: 'Upcoming',
  unmonitored: 'Not monitored',
}
const BADGES: Record<CalendarEntry['state'], string> = {
  downloaded: 'ok',
  missing: 'bad',
  upcoming: 'info',
  unmonitored: '',
}

const data = useRpc<CalendarData>()
const router = useRouter()
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const today = iso(Date.now())

// the view shows 4 weeks from a week ago, shifted by `offset` days
const offset = ref(0)
const from = computed(() => iso(Date.now() + (offset.value - 7) * DAY))
const to = computed(() => iso(Date.now() + (offset.value + 21) * DAY))
const shift = (days: number) => (offset.value += days)

const list = ref<CalendarEntry[]>([])
const loading = ref(false)
watch(
  () => [from.value, to.value, data.value.revision] as const,
  async ([start, end]) => {
    loading.value = true
    try {
      list.value = await data.value.range(start, end)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const days = computed(() => {
  const byDate = new Map<string, CalendarEntry[]>()
  for (const e of list.value) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  return [...byDate].map(([date, entries]) => ({ date, entries }))
})

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options)
const weekday = (date: string) => (date === today ? 'Today' : fmt(date, { weekday: 'short' }))
const month = (date: string) => fmt(date, { month: 'short' })
const label = computed(
  () =>
    `${fmt(from.value, { day: 'numeric', month: 'long' })} – ${fmt(to.value, { day: 'numeric', month: 'long', year: 'numeric' })}`,
)
const link = (e: CalendarEntry) =>
  e.kind === 'episode' ? `/series/${e.mediaId}` : `/movie/${e.mediaId}`
const feedUrl = `${location.origin}/api/v1/calendar.ics?apikey=YOUR_KEY`
</script>

<style scoped>
.day {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--mp-border);
}
.date {
  width: 56px;
  flex-shrink: 0;
  text-align: center;
  line-height: 1.2;
}
.weekday {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mp-muted);
}
.num {
  font-size: 22px;
  font-weight: 600;
}
.month {
  font-size: 12px;
}
.day.today .weekday,
.day.today .num {
  color: var(--mp-accent);
}
.items {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--mp-surface);
  border: 1px solid var(--mp-border);
  border-radius: var(--mp-radius);
  color: inherit;
  text-decoration: none;
}
.item:hover {
  border-color: var(--mp-accent);
}
.what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  margin-left: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--mp-muted);
}
.dot.downloaded {
  background: var(--mp-ok);
}
.dot.missing {
  background: var(--mp-bad);
}
.dot.upcoming {
  background: var(--mp-accent);
}
.subscribe {
  margin-top: 32px;
}
.subscribe summary {
  cursor: pointer;
  color: var(--mp-muted);
}
.url {
  display: block;
  padding: 10px 12px;
  background: var(--mp-surface);
  border: 1px solid var(--mp-border);
  border-radius: 6px;
  word-break: break-all;
  user-select: all;
}
</style>
