<template>
  <div class="providers" :data-testid="`providers-${kind}`">
    <div class="mp-card">
      <table v-if="entries.length">
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td>
              <strong>{{ e.config.name ?? labelOf(e.name) }}</strong>
              <span class="muted"> · {{ labelOf(e.name) }}</span>
            </td>
            <td :class="e.enabled ? 'ok' : 'muted'">{{ e.enabled ? 'enabled' : 'disabled' }}</td>
            <td class="actions">
              <button :data-testid="`edit-${e.id}`" @click="edit(e)">Edit</button>
              <button @click="remove(e)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">Nothing set up yet.</p>

      <div v-if="!form && addable.length" class="row">
        <select v-if="addable.length > 1" v-model="adding">
          <option v-for="p in addable" :key="p.name" :value="p.name">{{ p.label }}</option>
        </select>
        <button class="primary" :data-testid="`add-${kind}`" @click="start">
          Add {{ addable.length === 1 ? addable[0]!.label : '' }}
        </button>
      </div>

      <form v-if="form" class="form" @submit.prevent="save">
        <h3>{{ form.id ? 'Edit' : 'Add' }} {{ form.provider.label }}</h3>
        <label v-for="f in form.provider.fields" :key="f.key" class="field">
          <span class="label">{{ f.label }}<span v-if="f.required"> *</span></span>
          <input
            v-if="f.type === 'boolean'"
            v-model="form.values[f.key]"
            type="checkbox"
            :data-testid="`field-${f.key}`"
          />
          <select
            v-else-if="f.type === 'select'"
            v-model="form.values[f.key]"
            :data-testid="`field-${f.key}`"
          >
            <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
          </select>
          <input
            v-else
            v-model="form.values[f.key]"
            :type="f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'"
            :placeholder="
              f.type === 'secret' && form.secrets.includes(f.key)
                ? 'unchanged'
                : f.type === 'numbers'
                  ? 'comma separated'
                  : ''
            "
            :autocomplete="f.type === 'secret' ? 'new-password' : 'off'"
            :data-testid="`field-${f.key}`"
          />
          <span v-if="f.description" class="muted">{{ f.description }}</span>
        </label>
        <label class="field">
          <span class="label">Enabled</span>
          <input v-model="form.enabled" type="checkbox" data-testid="field-enabled" />
        </label>
        <div class="row">
          <button class="primary" type="submit" data-testid="save-provider">Save</button>
          <button type="button" @click="form = undefined">Cancel</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { SettingsData } from '../src/console'
import type { Provider, ProviderEntry, ProviderKind } from '../src/index'

const props = defineProps<{ kind: ProviderKind }>()
const data = useRpc<SettingsData>()

const providers = computed(() => data.value.providers.filter((p) => p.kind === props.kind))
const entries = computed(() =>
  data.value.entries.filter((e) => providers.value.some((p) => p.name === e.name)),
)
const addable = computed(() =>
  providers.value.filter((p) => !p.single || !entries.value.some((e) => e.name === p.name)),
)
const labelOf = (name: string) => providers.value.find((p) => p.name === name)?.label ?? name

interface Form {
  id?: string
  provider: Provider
  values: Record<string, unknown>
  secrets: string[]
  enabled: boolean
}
const form = ref<Form>()
const adding = ref('')
const error = ref('')

function toForm(provider: Provider, config: Record<string, unknown>) {
  const values: Record<string, unknown> = {}
  for (const f of provider.fields) {
    const value = config[f.key] ?? f.default
    values[f.key] = f.type === 'numbers' && Array.isArray(value) ? value.join(', ') : value
  }
  return values
}

function start() {
  const provider = addable.value.find((p) => p.name === adding.value) ?? addable.value[0]!
  error.value = ''
  form.value = { provider, values: toForm(provider, {}), secrets: [], enabled: true }
}

function edit(e: ProviderEntry) {
  const provider = providers.value.find((p) => p.name === e.name)!
  error.value = ''
  form.value = {
    id: e.id,
    provider,
    values: toForm(provider, e.config),
    secrets: e.secrets,
    enabled: e.enabled,
  }
}

async function save() {
  const f = form.value!
  const config: Record<string, unknown> = {}
  for (const field of f.provider.fields) {
    let value = f.values[field.key]
    if (field.type === 'numbers')
      value = String(value ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map(Number)
    else if (field.type === 'number')
      value = value === '' || value == null ? undefined : Number(value)
    else if (field.type !== 'boolean' && value === '') value = undefined
    config[field.key] = value
  }
  try {
    if (f.id) await data.value.update(f.id, config, f.enabled)
    else await data.value.add(f.provider.name, config, f.enabled)
    form.value = undefined
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function remove(e: ProviderEntry) {
  if (!confirm(`Remove ${e.config.name ?? labelOf(e.name)}?`)) return
  await data.value.remove(e.id)
}
</script>

<style scoped>
.muted {
  color: var(--mp-muted);
  font-size: 13px;
}
.ok {
  color: #2ea44f;
}
.error {
  color: #d33;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--mp-border);
}
.actions {
  width: 150px;
  text-align: right;
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.form {
  margin-top: 14px;
  display: grid;
  gap: 10px;
  max-width: 560px;
}
.form h3 {
  margin: 0;
}
.field {
  display: grid;
  gap: 2px;
}
.label {
  font-size: 13px;
  font-weight: 600;
}
.field input[type='checkbox'] {
  justify-self: start;
}
input,
select,
button {
  font: inherit;
  color: var(--mp-text);
  background: var(--mp-surface);
  border: 1px solid var(--mp-border);
  border-radius: 6px;
  padding: 4px 8px;
}
button {
  cursor: pointer;
}
button.primary {
  background: var(--mp-accent);
  color: #fff;
  border-color: transparent;
}
</style>
