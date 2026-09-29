<template>
  <section>
    <div class="mp-head"><h1>Subtitles</h1><a href="/settings/subtitles" @click.prevent="router.push('/settings/subtitles')">Profiles and providers</a></div>
    <p class="mp-lead">Missing languages, upgrades and detected subtitle tracks for each video file.</p>
    <div class="mp-row"><label>Filter <select v-model="state"><option value="wanted">Wanted</option><option value="all">All files</option><option v-for="s in ['missing','upgradeable','waiting','unknown','blocked','satisfied','disabled']" :key="s">{{ s }}</option></select></label><label>Kind <select v-model="kind"><option value="">All</option><option value="movie">Movies</option><option value="series">Series</option></select></label><label>Title or language <input v-model="term" /></label><button :disabled="busy" @click="scanAll">Scan shown files</button></div>
    <p v-if="message" role="status">{{ message }}</p>
    <div v-for="view in files" :key="view.file.id">
      <h2>{{ view.title }}</h2>
      <label>Profile <select :value="view.inherited?'inherit':view.profile?.id ?? 'disabled'" @change="assign(view.file.mediaId,($event.target as HTMLSelectElement).value)"><option value="inherit">Inherit default</option><option value="disabled">Disabled</option><option v-for="p in rpc.profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
      <File :view="view" />
    </div>
    <p v-if="!files.length" class="mp-card mp-muted">No files match. Assign a profile in Settings or show all files.</p>
    <details v-if="rpc.blocklist.length"><summary>Blocked candidates</summary><div v-for="b in rpc.blocklist" :key="b.id" class="mp-row"><span>File {{ b.fileId }} · {{ b.candidateId }}</span><button @click="rpc.unblock(b.id)">Unblock</button></div></details>
  </section>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {useRouter} from 'vue-router'
import {useRpc} from '@cordisjs/client'
import type {SubtitlesData} from '../src/console'
import File from './file.vue'
const data=useRpc<SubtitlesData>(),rpc=computed(()=>data.value),router=useRouter()
const state=ref('wanted'),kind=ref(''),term=ref(''),message=ref(''),busy=ref(false)
const files=computed(()=>rpc.value.files.filter(v=>(!kind.value || kind.value===v.kind) && (!term.value || `${v.title} ${v.profile?.requirements.map(r=>r.language).join(' ')}`.toLowerCase().includes(term.value.toLowerCase())) && (state.value==='all' || v.wanted.some(w=>state.value==='wanted' ? ['missing','upgradeable','waiting','unknown','blocked'].includes(w.state):w.state===state.value))))
async function scanAll(){busy.value=true;try{for(const v of files.value)await rpc.value.scan(v.file.id);message.value='Scans queued'}catch(e){message.value=String(e)}finally{busy.value=false}}
async function assign(id:number,value:string){try{await rpc.value.assign(id,value==='inherit'?'inherit':value==='disabled'?null:Number(value));message.value='Profile assigned'}catch(e){message.value=String(e)}}
</script>
