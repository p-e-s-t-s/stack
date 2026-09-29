<template>
  <section>
    <div class="mp-head"><h1>Subtitles</h1><button @click="create">New profile</button></div>
    <p class="mp-lead">Choose the languages each movie or episode needs. Automatic downloads start only when enabled in its assigned profile.</p>
    <p v-if="message" role="status" :class="bad ? 'mp-error' : 'mp-muted'">{{ message }}</p>
    <h2>Defaults</h2>
    <div class="mp-row" v-for="kind in (['movie','series'] as const)" :key="kind">
      <label>{{ kind === 'movie' ? 'Movies' : 'Series' }} <select :value="data.defaults.find(d=>d.kind===kind)?.profileId ?? ''" @change="run(()=>data.setDefault(kind,Number(($event.target as HTMLSelectElement).value)||null))"><option value="">Disabled</option><option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
    </div>
    <h2>Profiles</h2>
    <div class="mp-row"><button v-for="p in data.profiles" :key="p.id" @click="edit(p)">{{ p.name }}</button></div>
    <form v-if="draft" class="mp-card" @submit.prevent="save">
      <div class="mp-field"><label>Name <input v-model="draft.name" required maxlength="100" /></label></div>
      <div class="mp-row">
        <label><input type="checkbox" v-model="draft.policy.automatic" /> Automatic downloads</label>
        <label><input type="checkbox" v-model="draft.policy.monitoredOnly" /> Monitored files only</label>
        <label><input type="checkbox" v-model="draft.policy.upgrades" /> Upgrade managed subtitles</label>
      </div>
      <div class="mp-row">
        <label>Upgrade window (days) <input type="number" min="1" max="365" v-model.number="draft.policy.upgradeDays" /></label>
        <label>Minimum improvement <input type="number" min="1" max="100" v-model.number="draft.policy.upgradeDelta" /></label>
        <label>Sync <select v-model="draft.policy.sync"><option value="off">Off</option><option value="best-effort">Best effort</option><option value="required">Required before install</option></select></label>
      </div>
      <div v-for="(r,index) in draft.requirements" :key="r.id" class="mp-card">
        <div class="mp-row">
          <label>Language <input v-model="r.language" placeholder="en, pt-BR, zh-Hant" required /></label>
          <label>Content <select v-model="r.forced"><option value="full">Full</option><option value="forced">Forced</option><option value="either">Either / unknown accepted</option></select></label>
          <label>Hearing impaired <select v-model="r.hi"><option value="either">Either</option><option value="prefer">Prefer</option><option value="require">Require</option><option value="exclude">Exclude</option></select></label>
          <label><input type="checkbox" v-model="r.embedded" /> Embedded tracks count</label>
        </div>
        <div class="mp-row">
          <label>Minimum score <input type="number" min="0" max="100" v-model.number="r.minimum" /></label>
          <label>Upgrade cutoff <input type="number" :min="r.minimum" max="100" v-model.number="r.cutoff" /></label>
          <label v-for="f in (['srt','ass','ssa','vtt'] as const)" :key="f"><input type="checkbox" :value="f" v-model="r.formats" /> {{ f.toUpperCase() }}</label>
          <button type="button" @click="draft.requirements.splice(index,1)">Remove language</button>
        </div>
      </div>
      <p class="mp-help">Scores measure release matching, not translation quality. Unknown flags satisfy only an “Either” policy.</p>
      <div class="mp-row"><button type="button" @click="draft.requirements.push(requirement())">Add language</button><button class="primary" :disabled="busy">Save profile</button><button type="button" @click="draft=null">Cancel</button><button v-if="draft.id" type="button" class="danger" @click="remove">Delete profile</button></div>
    </form>
    <h2>Providers</h2>
    <k-slot name="provider-settings" :data="{kind:'subtitle',status:providerStatus,test:testProvider}" />
    <h2>Media tools</h2>
    <form class="mp-card" @submit.prevent="run(()=>data.saveTools(tools))">
      <div class="mp-field"><label>ffprobe executable <input v-model="tools.ffprobe" required /></label></div>
      <div class="mp-field"><label>Sync engine <select v-model="tools.syncEngine"><option value="ffsubsync">ffsubsync</option><option value="alass">alass</option></select></label></div>
      <div class="mp-field"><label>Sync executable <input v-model="tools.syncBinary" placeholder="Optional executable path" /></label></div>
      <p class="mp-help">Install the executable on the server. External sync supports SRT; offset adjustment also supports ASS, SSA and VTT.</p>
      <div class="mp-row"><button :disabled="busy">Save tools</button><button type="button" @click="checkTools">Test tools</button></div>
      <p v-if="health">ffprobe: {{ health.ffprobe }} · Sync: {{ health.sync }}</p>
    </form>
  </section>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {useRpc} from '@cordisjs/client'
import type {SubtitlesData} from '../src/console'
import type {Profile} from '../src/schema'
import type {SubtitleRequirement} from '@magpiejs/types'
const data = useRpc<SubtitlesData>()
const draft = ref<(Omit<Profile,'id'|'revision'> & {id?:number})|null>(null)
const tools = ref({...data.value.tools}), health = ref<{ffprobe:string;sync:string}>()
const busy = ref(false), message = ref(''), bad = ref(false)
const requirement = ():SubtitleRequirement => ({id:crypto.randomUUID().replaceAll('-',''),language:'en',forced:'full',hi:'either',embedded:true,minimum:80,cutoff:90,formats:['srt','ass','ssa','vtt']})
function create(){draft.value={name:'New profile',requirements:[requirement()],policy:{automatic:false,monitoredOnly:true,upgrades:false,upgradeDays:30,upgradeDelta:5,sync:'off'}}}
function edit(p:Profile){draft.value=JSON.parse(JSON.stringify(p))}
async function run(fn:()=>Promise<unknown>){busy.value=true;bad.value=false;try{await fn();message.value='Saved.'}catch(e){message.value=String(e);bad.value=true}finally{busy.value=false}}
async function save(){await run(async()=>{const p=await data.value.saveProfile(draft.value,draft.value?.id);edit(p)})}
async function remove(){if(draft.value?.id && confirm('Delete this subtitle profile?'))await run(async()=>{await data.value.removeProfile(draft.value!.id!);draft.value=null})}
const entryId=(id:string)=>id.slice(id.indexOf(':')+1)
const providerStatus=computed(()=>Object.fromEntries(data.value.providers.map(p=>[entryId(p.id),{ok:!p.error,text:p.error?'Paused':'Ready',detail:p.error ?? (p.remaining === null || p.remaining === undefined ? 'Quota unknown' : `${p.remaining} downloads remaining`)}])))
async function testProvider(id:string){const p=data.value.providers.find(p=>entryId(p.id)===id);return p?data.value.testProvider(p.id):{ok:false,message:'Provider is not running'}}
async function checkTools(){await run(async()=>{health.value=await data.value.toolHealth()})}
</script>
