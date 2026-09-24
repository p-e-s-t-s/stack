import type { ReleaseInfo } from '@magpiejs/types'
import { type BaseParsed, type FamilyCondition, safeRegex } from './families'
import type { Condition, CustomFormat } from './schema'

export interface FormatInput {
  parsed: BaseParsed
  info: Pick<ReleaseInfo, 'title' | 'size'> & { flags?: string[] }
  originalLanguage?: string
}

/** Condition types every family understands. */
export const GENERIC_CONDITIONS: Record<string, { label: string }> = {
  title: { label: 'Release name (regex)' },
  group: { label: 'Release group (regex)' },
  language: { label: 'Language' },
  size: { label: 'Size (GB)' },
  indexerFlag: { label: 'Indexer flag' },
}

function test(
  condition: Condition,
  { parsed, info, originalLanguage }: FormatInput,
  family: Record<string, FamilyCondition<BaseParsed>>,
): boolean | undefined {
  const value = condition.value
  if (condition.type === 'size') {
    if (typeof value !== 'object' || info.size === undefined) return false
    const gb = info.size / 1024 ** 3
    return (
      (value.min === undefined || gb >= value.min) && (value.max === undefined || gb <= value.max)
    )
  }
  if (typeof value !== 'string') return false
  switch (condition.type) {
    case 'title':
      return safeRegex(value).test(info.title)
    case 'group':
      return !!parsed.group && safeRegex(value).test(parsed.group)
    case 'language':
      return parsed.languages.includes(value === 'original' ? (originalLanguage ?? '') : value)
    case 'indexerFlag':
      return !!info.flags?.includes(value)
  }
  // undefined: a condition of another family, which makes the whole format not apply
  return family[condition.type]?.test(parsed, value)
}

/**
 * A format matches when every required condition matches and, if it has optional ones,
 * at least one of those matches. Negation applies before either check.
 */
export function formatMatches(
  format: Pick<CustomFormat, 'conditions'>,
  input: FormatInput,
  familyConditions: Record<string, FamilyCondition<BaseParsed>> = {},
) {
  const tested = format.conditions.map((c) => ({ c, ok: test(c, input, familyConditions) }))
  if (!tested.length || tested.some((t) => t.ok === undefined)) return false
  const results = tested.map(({ c, ok }) => ({ required: !!c.required, ok: ok !== !!c.negate }))
  const required = results.filter((r) => r.required)
  const optional = results.filter((r) => !r.required)
  return required.every((r) => r.ok) && (!optional.length || optional.some((r) => r.ok))
}
