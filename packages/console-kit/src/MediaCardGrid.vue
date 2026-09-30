<template>
  <section>
    <div class="mp-head">
      <h1>{{ title }}</h1>
      <slot name="before-actions" />
      <input v-if="items.length" v-model="filter" placeholder="Filter" class="mp-filter" />
      <slot name="actions" />
    </div>
    <p v-if="items.length && summary" class="mp-lead">{{ summary }}</p>
    <slot name="notices" />
    <p v-if="!items.length" class="mp-empty">
      <slot name="empty">No items yet.</slot>
    </p>
    <div class="mp-grid">
      <NavLink
        v-for="item in shown"
        :key="itemKey(item)"
        class="tile"
        :to="itemHref(item)"
        :data-testid="cardTestId"
      >
        <img
          v-if="itemImage(item) && !broken.has(itemKey(item))"
          class="poster"
          :src="itemImage(item)!"
          loading="lazy"
          alt=""
          @error="broken.add(itemKey(item))"
        />
        <div v-else class="poster placeholder">{{ itemTitle(item) }}</div>
        <div class="title">{{ itemTitle(item) }}</div>
        <div class="meta"><slot name="meta" :item="item" /></div>
      </NavLink>
    </div>
  </section>
</template>

<script lang="ts" setup generic="T">
// The list page of a media kind: heading and buttons, a filter box, a summary line, the
// card grid, and the empty state. The kind supplies the items, how to name and link them,
// and what goes under each card (`meta`). Classes on the component (`class="mv"`) land on
// the section so a kind's own stylesheet still applies.
import { computed, reactive, ref } from 'vue'
import NavLink from './NavLink.vue'

const props = defineProps<{
  title: string
  items: T[]
  itemKey: (item: T) => string | number
  itemTitle: (item: T) => string
  itemHref: (item: T) => string
  /** Poster or cover; nothing (or a URL that fails to load) shows the title instead. */
  itemImage: (item: T) => string | null | undefined
  summary?: string
  cardTestId?: string
}>()

const filter = ref('')
const broken = reactive(new Set<string | number>())
const shown = computed(() => {
  const needle = filter.value.toLowerCase()
  return props.items.filter((item) => props.itemTitle(item).toLowerCase().includes(needle))
})
</script>
