<template>
  <form class="mp-row mp-search" @submit.prevent="emit('search')">
    <input
      :value="modelValue"
      :placeholder="placeholder"
      data-testid="lookup"
      autofocus
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button class="primary" type="submit" :disabled="!modelValue.trim() || searching">
      {{ searching ? 'Searching…' : 'Search' }}
    </button>
  </form>
</template>

<script lang="ts" setup>
defineProps<{ modelValue: string; placeholder: string; searching?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [term: string]; search: [] }>()
</script>
