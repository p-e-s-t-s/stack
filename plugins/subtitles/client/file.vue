<template>
  <article class="mp-card">
    <div class="mp-row"><strong>{{ view.file.path }}</strong><button :disabled="busy" @click="run(()=>rpc.scan(view.file.id),'Scan queued')">Scan</button></div>
    <p v-if="view.probeError" class="mp-error">{{ view.probeError }}</p>
    <p v-if="!view.profile" class="mp-muted">Subtitles disabled. Assign a profile to manage this file.</p>
    <div v-for="r in view.profile?.requirements ?? []" :key="r.id" class="mp-row">
      <span>{{ r.language }} · {{ r.forced }} · HI {{ r.hi }}</span>
      <span class="mp-badge">{{ view.wanted.find(w=>w.requirementId===r.id)?.state ?? 'Scan pending' }}</span>
      <span class="mp-small mp-muted">{{ view.wanted.find(w=>w.requirementId===r.id)?.reason }}</span>
      <span v-if="view.wanted.find(w=>w.requirementId===r.id)?.nextSearchAt" class="mp-small">Next check: {{ new Date(view.wanted.find(w=>w.requirementId===r.id)!.nextSearchAt).toLocaleString() }}</span>
      <button :disabled="busy" @click="search(r.id)">Search {{ r.language }}</button>
    </div>
    <table v-if="view.inventory.some(s=>s.present)" class="mp-table">
      <thead><tr><th>Subtitle</th><th>Flags</th><th>Origin / score</th><th>Timing</th><th>Actions</th></tr></thead>
      <tbody><tr v-for="s in view.inventory.filter(s=>s.present)" :key="s.id">
        <td>{{ s.language ?? 'Unknown language' }} <span class="mp-muted">{{ s.format }} · {{ s.embedded?'Embedded':s.location }}</span><div v-if="s.error" class="mp-error">{{ s.error }}</div></td>
        <td>{{ s.forced === null ? 'Forced unknown' : s.forced ? 'Forced' : 'Full' }} · {{ s.hi === null ? 'HI unknown' : s.hi ? 'HI' : 'Non-HI' }}</td>
        <td>{{ s.managed?'Managed':'Existing' }}{{ s.protected?' · Protected':'' }}<div class="mp-small">{{ s.providerId }} {{ s.score === null?'':`· ${s.score}` }}</div></td>
        <td>{{ s.sync }}<div v-if="s.syncError" class="mp-error mp-small">{{ s.syncError }}</div></td>
        <td v-if="!s.embedded"><div class="mp-row">
          <button v-if="!s.managed && s.valid" :disabled="busy" @click="adopt(s.id)">Adopt</button>
          <button v-if="s.managed" :disabled="busy" @click="run(()=>rpc.protect(s.id,!s.protected),'Protection updated')">{{ s.protected?'Unprotect':'Protect' }}</button>
          <button v-if="s.managed && !s.protected" :disabled="busy" @click="run(()=>rpc.sync(s.id),'Sync queued')">Auto sync</button>
          <button v-if="s.managed && !s.protected" :disabled="busy" @click="offset(s.id)">Adjust offset</button>
        </div></td><td v-else />
      </tr></tbody>
    </table>
    <p v-else class="mp-muted">No detected subtitles.</p>
    <p v-if="message" role="status" :class="bad?'mp-error':'mp-muted'">{{ message }}</p>
    <div v-if="results">
      <h3>Search results</h3>
      <p v-for="e in results.errors" :key="e.provider" class="mp-error">{{ e.provider }}: {{ e.message }}</p>
      <p v-if="!results.rows.length" class="mp-muted">No results.</p>
      <table class="mp-table"><thead><tr><th>Release</th><th>Score / evidence</th><th>Actions</th></tr></thead><tbody>
        <tr v-for="r in results.rows" :key="r.token"><td>{{ r.name }}<div class="mp-muted mp-small">{{ r.provider }} · {{ r.language ?? 'Unknown' }} · {{ r.format }}</div></td><td>{{ r.score }}<div class="mp-small">{{ r.evidence.join(', ') }}</div><div class="mp-error mp-small">{{ r.reasons.join('; ') }}</div></td><td><button :disabled="busy" @click="download(r)">{{ r.reasons.length?'Download with override':'Download' }}</button><button :disabled="busy" @click="run(()=>rpc.block(r.token),'Blocked; search again')">Block</button></td></tr>
      </tbody></table>
    </div>
    <details v-if="operations.length"><summary>Recent replacements / undo</summary><div v-for="op in operations" :key="op.id" class="mp-row"><span>{{ op.record.location }} · {{ op.state }} · {{ new Date(op.createdAt).toLocaleString() }}</span><span v-if="op.error" class="mp-error">{{ op.error }}</span><button v-if="op.state==='done' && op.oldHash" :disabled="busy" @click="run(()=>rpc.undo(op.id),'Previous subtitle restored and protected')">Undo</button></div></details>
  </article>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {useRpc} from '@cordisjs/client'
import type {SubtitlesData} from '../src/console'
import type {FileView,SearchRow} from '../src'
const props=defineProps<{view:FileView}>()
const data=useRpc<SubtitlesData>(), rpc=computed(()=>data.value)
const results=ref<Awaited<ReturnType<SubtitlesData['search']>>>()
const busy=ref(false),message=ref(''),bad=ref(false)
const operations=computed(()=>data.value.operations.filter(o=>o.fileId===props.view.file.id).slice(-10).reverse())
async function run(fn:()=>Promise<unknown>,success:string){busy.value=true;bad.value=false;try{await fn();message.value=success}catch(e){bad.value=true;message.value=String(e)}finally{busy.value=false}}
async function search(id:string){await run(async()=>{results.value=await rpc.value.search(props.view.file.id,id)},'Search complete')}
async function download(r:SearchRow){if(r.reasons.length && !confirm(`This subtitle has matching problems: ${r.reasons.join('; ')}. Download it anyway?`))return;await run(()=>rpc.value.acquire(r.token,r.reasons.length>0),'Download queued')}
async function adopt(id:number){if(confirm('Allow Magpie to manage and replace this existing subtitle?'))await run(()=>rpc.value.adopt(id),'Subtitle adopted')}
async function offset(id:number){const value=prompt('Offset in seconds (positive delays subtitles):','0');if(value===null)return;const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>600){bad.value=true;message.value='Enter an offset between -600 and 600 seconds';return}await run(()=>rpc.value.sync(id,n),'Offset adjustment queued')}
</script>
