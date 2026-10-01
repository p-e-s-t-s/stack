<template>
  <section>
    <div class="mp-head">
      <h1>{{ title }}</h1>
    </div>
    <slot name="notice" />
    <SearchBox
      :model-value="term"
      :placeholder="placeholder"
      :searching="searching"
      @update:model-value="emit('update:term', $event)"
      @search="emit('search')"
    />
    <p v-if="error" class="mp-error">{{ error }}</p>

    <template v-if="results.length">
      <LocationNotice v-if="!hasLocation" />
      <div v-else-if="optionsCard" class="mp-card mp-options"><slot name="options" /></div>
      <slot v-else name="options" />
      <LookupResult
        v-for="r in results"
        :key="resultKey(r)"
        :title="resultTitle(r)"
        :subtitle="resultSubtitle?.(r)"
        :overview="resultOverview?.(r)"
        :image="resultImage?.(r)"
        :no-image="!resultImage"
      >
        <slot name="action" :result="r" />
      </LookupResult>
    </template>
  </section>
</template>

<script lang="ts" setup generic="T">
// The add page of a media kind: search box, the options for what to do with a pick, and
// the results. The kind supplies the lookup (it owns `term`, `results` and `searching`),
// the option fields (`options`), and the button on each result (`action`). When the kind has
// no library folder yet, the options are replaced by a notice pointing at the setting.
import LocationNotice from '../LocationNotice.vue'
import LookupResult from '../LookupResult.vue'
import SearchBox from '../SearchBox.vue'

withDefaults(
  defineProps<{
    title: string
    placeholder: string
    term: string
    searching?: boolean
    error?: string
    results: T[]
    /** False shows "choose a library location" instead of the options. */
    hasLocation?: boolean
    /** False when the options bring their own cards (books: one per format). Default true. */
    optionsCard?: boolean
    resultKey: (result: T) => string | number
    resultTitle: (result: T) => string
    resultSubtitle?: (result: T) => string | number | null | undefined
    resultOverview?: (result: T) => string | null | undefined
    /** Leave out for kinds whose results have no artwork. */
    resultImage?: (result: T) => string | null | undefined
  }>(),
  { hasLocation: true, optionsCard: true },
)
const emit = defineEmits<{ 'update:term': [term: string]; search: [] }>()
</script>
