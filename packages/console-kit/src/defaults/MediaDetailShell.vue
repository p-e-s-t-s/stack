<template>
  <section>
    <NavLink class="mp-back" :to="backTo">← {{ backLabel }}</NavLink>
    <div class="mp-hero">
      <img v-if="image && !broken" class="poster" :src="image" alt="" @error="broken = true" />
      <div v-else class="poster placeholder">{{ title }}</div>
      <div class="info">
        <h1>
          {{ title }} <span v-if="year" class="mp-muted year">{{ year }}</span>
        </h1>
        <div v-if="$slots.facts" class="facts mp-muted"><slot name="facts" /></div>
        <div v-if="$slots.status" class="status"><slot name="status" /></div>
        <p v-if="overview" class="overview">{{ overview }}</p>
        <div v-if="$slots.actions" class="mp-row"><slot name="actions" /></div>
        <p v-if="message" class="mp-small" :class="messageBad ? 'mp-error' : 'mp-muted'">
          {{ message }}
        </p>
      </div>
    </div>
    <slot />
  </section>
</template>

<script lang="ts" setup>
// The header of a media detail page: a way back, the poster, the title and year, facts,
// status, overview, and the action buttons. Everything below the header is the default
// slot. Classes on the component (`class="mv"`) land on the section.
import { ref, watch } from 'vue'
import NavLink from '../NavLink.vue'

const props = defineProps<{
  backTo: string
  backLabel: string
  title: string
  year?: string | number | null
  image?: string | null
  overview?: string | null
  /** Feedback from the last action, shown under the buttons. */
  message?: string
  messageBad?: boolean
}>()

const broken = ref(false)
watch(
  () => props.image,
  () => (broken.value = false),
)
</script>
