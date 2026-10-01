// Which themes apply to a user, most specific first (docs/themes.md §4.3, §5.1). Pure, so
// the rules are tested without a server.

import { DEFAULT_THEME } from '@magpiejs/console-kit'

/** The theme contract version this build understands. */
export const API_VERSION = 1

export interface ThemeDefinition {
  /** Lowercase letters, digits and dashes; `default` is the built-in and cannot be registered. */
  id: string
  name: string
  description?: string
  /** The theme this one inherits parts from; the built-in default when omitted. */
  extends?: string
  /** The contract version the theme was written against. */
  apiVersion: number
  /** A few CSS colours for the picker card. */
  swatch?: readonly string[]
}

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/

type Themes = ReadonlyMap<string, Pick<ThemeDefinition, 'extends'>>

/**
 * The chain for one theme: itself, its parents, then the default. Undefined when the theme is
 * unavailable: unknown, a parent is not installed, or the parents loop. A theme that is
 * `default` has the chain `['default']`.
 */
export function chainOf(id: string, themes: Themes): string[] | undefined {
  const chain: string[] = []
  let current: string | undefined = id
  while (current && current !== DEFAULT_THEME) {
    if (chain.includes(current)) return undefined // a loop
    const theme = themes.get(current)
    if (!theme) return undefined // not installed
    chain.push(current)
    current = theme.extends
  }
  return [...chain, DEFAULT_THEME]
}

/**
 * The chain to use: the first of `wanted` (a user's choice, then the instance default) that is
 * available, else the built-in default alone.
 */
export function resolveChain(wanted: readonly (string | null | undefined)[], themes: Themes) {
  for (const id of wanted) {
    if (!id) continue
    const chain = chainOf(id, themes)
    if (chain) return chain
  }
  return [DEFAULT_THEME]
}
