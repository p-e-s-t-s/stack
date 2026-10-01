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
    <p v-if="!items.length" class="mp-empty"><slot name="empty">No items yet.</slot></p>
    <table v-else class="mp-table dock-table">
      <tbody>
        <tr v-for="item in shown" :key="itemKey(item)" :data-testid="cardTestId">
          <td class="dock-thumb">
            <img v-if="itemImage(item)" :src="itemImage(item)!" loading="lazy" alt="" />
          </td>
          <td>
            <a :href="itemHref(item)" @click="open($event, itemHref(item))">{{
              itemTitle(item)
            }}</a>
          </td>
          <td class="dock-meta"><slot name="meta" :item="item" /></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script lang="ts" setup generic="T">
// The same props and slots as the built-in library list (`media.list`), drawn as a table.
import { computed, ref } from 'vue'
import { useRouter } from '@cordisjs/client'

const props = defineProps<{
  title: string
  items: T[]
  itemKey: (item: T) => string | number
  itemTitle: (item: T) => string
  itemHref: (item: T) => string
  itemImage: (item: T) => string | null | undefined
  summary?: string
  cardTestId?: string
}>()

const router = useRouter()
const filter = ref('')
const shown = computed(() => {
  const needle = filter.value.toLowerCase()
  return props.items.filter((item) => props.itemTitle(item).toLowerCase().includes(needle))
})
function open(event: MouseEvent, path: string) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  void router.push(path)
}
</script>
