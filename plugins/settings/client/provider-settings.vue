<template>
  <div class="providers" :data-testid="`providers-${kind}`">
    <table v-if="entries.length" class="mp-table">
      <tbody>
        <tr v-for="e in entries" :key="e.id">
          <td>
            <strong>{{ e.config.name ?? labelOf(e.name) }}</strong>
            <div class="mp-muted mp-small">
              {{ labelOf(e.name)
              }}<template v-if="status?.[e.id]?.detail"> · {{ status[e.id]!.detail }}</template>
            </div>
          </td>
          <td class="state">
            <span v-if="!e.enabled" class="mp-badge">Off</span>
            <span v-else-if="tests[e.id]" class="mp-badge" :class="tests[e.id]!.ok ? 'ok' : 'bad'">
              {{ tests[e.id]!.ok ? 'Works' : 'Failed' }}
            </span>
            <span
              v-else-if="status?.[e.id]"
              class="mp-badge"
              :class="status[e.id]!.ok ? 'ok' : 'bad'"
              >{{ status[e.id]!.text }}</span
            >
            <div
              v-if="tests[e.id]?.message"
              class="mp-small"
              :class="{ 'mp-error': !tests[e.id]!.ok }"
            >
              {{ tests[e.id]!.message }}
            </div>
          </td>
          <td class="actions">
            <button
              v-if="test && e.enabled"
              class="small"
              :disabled="testing === e.id"
              @click="runTest(e)"
            >
              {{ testing === e.id ? 'Testing…' : 'Test' }}
            </button>
            <button class="small" :data-testid="`edit-${e.id}`" @click="edit(e)">Edit</button>
            <button class="small danger" @click="remove(e)">Remove</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!form" class="mp-card mp-muted">Nothing set up yet.</p>

    <div v-if="!form && addable.length" class="mp-row add">
      <select v-if="addable.length > 1" v-model="adding">
        <option v-for="p in addable" :key="p.name" :value="p.name">{{ p.label }}</option>
      </select>
      <button class="primary" :data-testid="`add-${kind}`" @click="start">
        Add {{ addable.length === 1 ? addable[0]!.label : '' }}
      </button>
    </div>

    <form v-if="form" class="mp-card form" @submit.prevent="save">
      <h3>{{ form.id ? 'Edit' : 'Add' }} {{ form.provider.label }}</h3>
      <div v-for="f in basicFields" :key="f.key" class="mp-field">
        <label :for="`f-${f.key}`">{{ f.label }}</label>
        <field-input :field="f" :form="form" />
        <span v-if="f.description" class="mp-help">{{ f.description }}</span>
      </div>
      <details v-if="moreFields.length" class="more">
        <summary>More options</summary>
        <div v-for="f in moreFields" :key="f.key" class="mp-field">
          <label :for="`f-${f.key}`">{{ f.label }}</label>
          <field-input :field="f" :form="form" />
          <span v-if="f.description" class="mp-help">{{ f.description }}</span>
        </div>
      </details>
      <div class="mp-field">
        <label for="f-enabled">Enabled</label>
        <div>
          <input
            id="f-enabled"
            v-model="form.enabled"
            type="checkbox"
            data-testid="field-enabled"
          />
        </div>
      </div>
      <p v-if="error" class="mp-error">{{ error }}</p>
      <div class="mp-row">
        <button class="primary" type="submit" data-testid="save-provider" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button type="button" @click="form = undefined">Cancel</button>
      </div>
    </form>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineComponent, h, reactive, ref } from 'vue'
import { useRpc } from '@cordisjs/client'
import type { SettingsData } from '../src/console'
import type { Field, Provider, ProviderEntry, ProviderKind } from '../src/index'

interface TestResult {
  ok: boolean
  message?: string
}

const props = defineProps<{
  kind: ProviderKind
  /** Live status per entry id, from the page that shows this list. */
  status?: Record<string, { ok: boolean; text: string; detail?: string }>
  test?: (entryId: string) => Promise<TestResult>
}>()
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
const saving = ref(false)

const isBasic = (f: Field) =>
  !form.value!.provider.basic || form.value!.provider.basic.includes(f.key)
const basicFields = computed(() => form.value?.provider.fields.filter(isBasic) ?? [])
const moreFields = computed(() => form.value?.provider.fields.filter((f) => !isBasic(f)) ?? [])

// one input for a field, by type
const FieldInput = defineComponent({
  props: {
    field: { type: Object as () => Field, required: true },
    form: { type: Object as () => Form, required: true },
  },
  setup(p) {
    return () => {
      const f = p.field
      const values = p.form.values
      const common = { id: `f-${f.key}`, 'data-testid': `field-${f.key}` }
      if (f.type === 'boolean')
        return h('div', [
          h('input', {
            ...common,
            type: 'checkbox',
            checked: !!values[f.key],
            onChange: (e: Event) => (values[f.key] = (e.target as HTMLInputElement).checked),
          }),
        ])
      if (f.type === 'select')
        return h(
          'select',
          {
            ...common,
            value: values[f.key],
            onChange: (e: Event) => (values[f.key] = (e.target as HTMLSelectElement).value),
          },
          f.options!.map((o) => h('option', { value: o }, o)),
        )
      const secretSet = f.type === 'secret' && p.form.secrets.includes(f.key)
      return h('input', {
        ...common,
        type: f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text',
        value: values[f.key] ?? '',
        placeholder: secretSet
          ? 'saved — leave empty to keep'
          : f.type === 'numbers'
            ? 'e.g. 2000, 2040'
            : '',
        autocomplete: f.type === 'secret' ? 'new-password' : 'off',
        required: f.required && !secretSet,
        onInput: (e: Event) => (values[f.key] = (e.target as HTMLInputElement).value),
      })
    }
  },
})

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
  form.value = reactive({ provider, values: toForm(provider, {}), secrets: [], enabled: true })
}

function edit(e: ProviderEntry) {
  const provider = providers.value.find((p) => p.name === e.name)!
  error.value = ''
  form.value = reactive({
    id: e.id,
    provider,
    values: toForm(provider, e.config),
    secrets: e.secrets,
    enabled: e.enabled,
  })
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
  saving.value = true
  error.value = ''
  try {
    if (f.id) await data.value.update(f.id, config, f.enabled)
    else await data.value.add(f.provider.name, config, f.enabled)
    form.value = undefined
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove(e: ProviderEntry) {
  if (!confirm(`Remove ${e.config.name ?? labelOf(e.name)}?`)) return
  await data.value.remove(e.id)
}

const tests = reactive<Record<string, TestResult>>({})
const testing = ref<string>()
async function runTest(e: ProviderEntry) {
  testing.value = e.id
  try {
    tests[e.id] = await props.test!(e.id)
  } catch (error) {
    tests[e.id] = { ok: false, message: (error as Error).message }
  } finally {
    testing.value = undefined
  }
}
</script>

<style scoped>
.state {
  width: 160px;
}
.add {
  margin-top: 12px;
}
.form {
  margin-top: 16px;
}
.more {
  margin: 8px 0;
}
.more summary {
  cursor: pointer;
  color: var(--mp-muted);
  padding: 6px 0;
}
</style>
