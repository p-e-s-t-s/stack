// Turns a provider's schemastery Config into simple form fields for the web console.

import type z from 'schemastery'

export interface Field {
  key: string
  label: string
  /** `numberDict`: lists of numbers by key, e.g. categories per kind. */
  type: 'string' | 'secret' | 'number' | 'boolean' | 'select' | 'numbers' | 'numberDict'
  required: boolean
  default?: unknown
  description?: string
  options?: string[]
}

const WORDS: Record<string, string> = { url: 'URL', api: 'API', rss: 'RSS', id: 'ID', tv: 'TV' }

/** `apiKey` → `API key`, `enableRss` → `Enable RSS`. */
export function labelOf(key: string) {
  const words = key.split(/(?=[A-Z])/).map((w) => w.toLowerCase())
  const text = words.map((w) => WORDS[w] ?? w).join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type Schema = z & {
  type: string
  dict?: Record<string, Schema>
  list?: Schema[]
  inner?: Schema
  value?: unknown
  meta: {
    required?: boolean
    default?: unknown
    description?: unknown
    role?: string
    hidden?: boolean
  }
}

export function fieldsOf(config: z): Field[] {
  const schema = config as Schema
  if (schema.type !== 'object' || !schema.dict) return []
  const fields: Field[] = []
  for (const [key, s] of Object.entries(schema.dict)) {
    if (s.meta.hidden) continue
    const base = {
      key,
      label: labelOf(key),
      required: !!s.meta.required,
      default: s.meta.default,
      // descriptions are Markdown; the form shows plain text
      description:
        typeof s.meta.description === 'string' ? s.meta.description.replace(/`/g, '') : undefined,
    }
    if (s.type === 'string')
      fields.push({ ...base, type: s.meta.role === 'secret' ? 'secret' : 'string' })
    else if (s.type === 'number') fields.push({ ...base, type: 'number' })
    else if (s.type === 'boolean') fields.push({ ...base, type: 'boolean' })
    else if (s.type === 'union' && s.list?.every((x) => x.type === 'const'))
      fields.push({ ...base, type: 'select', options: s.list.map((x) => String(x.value)) })
    else if (s.type === 'array' && s.inner?.type === 'number')
      fields.push({ ...base, type: 'numbers' })
    else if (s.type === 'dict' && s.inner?.type === 'array' && s.inner.inner?.type === 'number')
      fields.push({ ...base, type: 'numberDict' })
  }
  return fields
}
