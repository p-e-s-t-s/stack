import type { ParsedRelease } from '@magpiejs/parser'
import type { ReleaseInfo } from '@magpiejs/types'
import type { Condition, CustomFormat } from './schema'

export interface FormatInput {
  parsed: ParsedRelease
  info: Pick<ReleaseInfo, 'title' | 'size'> & { flags?: string[] }
  originalLanguage?: string
}

function regex(pattern: string) {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return /(?!)/ // an invalid pattern matches nothing
  }
}

function test(condition: Condition, { parsed, info, originalLanguage }: FormatInput): boolean {
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
      return regex(value).test(info.title)
    case 'group':
      return !!parsed.group && regex(value).test(parsed.group)
    case 'edition':
      return !!parsed.edition && regex(value).test(parsed.edition)
    case 'source':
      return parsed.source === value
    case 'resolution':
      return parsed.resolution === value
    case 'modifier':
      return parsed.modifiers.includes(value as never)
    case 'language':
      return parsed.languages.includes(value === 'original' ? (originalLanguage ?? '') : value)
    case 'hdr':
      return parsed.video.hdr.includes(value as never)
    case 'videoCodec':
      return parsed.video.codec === value
    case 'audioCodec':
      return parsed.audio.codecs.includes(value as never)
    case 'streamingService':
      return parsed.streamingService === value
    case 'indexerFlag':
      return !!info.flags?.includes(value)
  }
}

/**
 * A format matches when every required condition matches and, if it has optional ones,
 * at least one of those matches. Negation applies before either check.
 */
export function formatMatches(format: Pick<CustomFormat, 'conditions'>, input: FormatInput) {
  const results = format.conditions.map((c) => ({
    required: !!c.required,
    ok: test(c, input) !== !!c.negate,
  }))
  if (!results.length) return false
  const required = results.filter((r) => r.required)
  const optional = results.filter((r) => !r.required)
  return required.every((r) => r.ok) && (!optional.length || optional.some((r) => r.ok))
}
