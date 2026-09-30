<template>
  <section v-if="mediaId">
    <h2>Subtitles</h2>
    <label>Profile <select :value="assignment" @change="assign(($event.target as HTMLSelectElement).value)"><option value="inherit">Inherit {{ effectiveName }}</option><option value="disabled">Disabled</option><option v-for="p in rpc.profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
    <p v-if="message" class="mp-error">{{ message }}</p>
    <File v-for="v in files" :key="v.file.id" :view="v" />
    <p v-if="!files.length" class="mp-muted">Subtitles become available when a video file is imported.</p>
  </section>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {useRpc} from '@cordisjs/client'
import type {SubtitlesData} from '../src/console'
import File from './file.vue'
const props=defineProps<{movie?:{id:number};series?:{id:number}}>()
const data=useRpc<SubtitlesData>(),rpc=computed(()=>data.value),message=ref('')
const mediaId=computed(()=>props.movie?.id ?? props.series?.id)
const files=computed(()=>rpc.value.files.filter(f=>f.file.mediaId===mediaId.value))
const item=computed(()=>rpc.value.media.find(m=>m.id===mediaId.value))
const assignment=computed(()=>item.value?.inherited !== false ? 'inherit' : item.value?.profile?.id ?? 'disabled')
const effectiveName=computed(()=>item.value?.inherited ? `(${item.value?.profile?.name ?? 'disabled'})` : '')
async function assign(value:string){try{await rpc.value.assign(mediaId.value!,value==='inherit'?'inherit':value==='disabled'?null:Number(value));message.value=''}catch(e){message.value=String(e)}}
</script>
