<template>
  <div class="mp-tabs">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      :class="{ active: tab.key === modelValue }"
      :data-testid="tab.testId"
      @click="select(tab.key)"
    >
      {{ tab.label }}
    </button>
    <slot />
  </div>
</template>

<script lang="ts" setup generic="K extends string | number">
// The underlined tab row used across the console. `v-model` is the active key; a tab that is
// not in the list (a "New profile" draft) can be shown active by passing its key too.
defineProps<{
  tabs: { key: K; label: string; testId?: string }[]
  modelValue?: K | null
}>()
const emit = defineEmits<{ 'update:modelValue': [key: K]; select: [key: K] }>()

function select(key: K) {
  emit('update:modelValue', key)
  emit('select', key)
}
</script>
