<template>
  <label>
    <span>Quality</span>
    <select :value="profileId" @change="emit('update:profileId', pick($event))">
      <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
  </label>
  <label v-if="rootFolders.length > 1">
    <span>Folder</span>
    <select :value="rootFolderId" @change="emit('update:rootFolderId', pick($event))">
      <option v-for="f in rootFolders" :key="f.id" :value="f.id">{{ f.path }}</option>
    </select>
  </label>
</template>

<script lang="ts" setup>
// The Quality and Folder selects every add form starts with. The folder is only asked for
// when there is more than one. Sits inside an `.mp-options` card.
defineProps<{
  profiles: { id: number; name: string }[]
  rootFolders: { id: number; path: string }[]
  profileId?: number
  rootFolderId?: number
}>()
const emit = defineEmits<{
  'update:profileId': [id: number]
  'update:rootFolderId': [id: number]
}>()
const pick = (event: Event) => Number((event.target as HTMLSelectElement).value)
</script>
