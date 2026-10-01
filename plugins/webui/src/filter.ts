// Hides top-level keys of an entry's data from callers who may not see them. Console data
// reaches the browser as a snapshot and then as muon mutations, so both are filtered here.

import type { Mutation, PathSegment } from '@cordisjs/muon'

/** A copy of `data` without the keys in `hidden`. */
export function omitKeys<T extends object>(data: T, hidden: ReadonlySet<string>): Partial<T> {
  if (!hidden.size) return data
  return Object.fromEntries(Object.entries(data).filter(([key]) => !hidden.has(key))) as Partial<T>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The part of a mutation a caller may see, or `undefined` if none of it. Paths in a batch
 * are relative to the batch, so `at` is the path of the mutation that holds it.
 */
export function filterMutation(
  mutation: Mutation,
  hidden: ReadonlySet<string>,
  at: readonly PathSegment[] = [],
): Mutation | undefined {
  if (!hidden.size) return mutation
  const path = [...at, ...mutation.path]
  const { kind } = mutation
  if (kind.type === 'batch') {
    const items = kind.items.flatMap((item) => filterMutation(item, hidden, path) ?? [])
    return items.length ? { path: mutation.path, kind: { type: 'batch', items } } : undefined
  }
  if (path.length === 0) {
    // the whole data object was replaced
    if (kind.type === 'replace' && isObject(kind.value))
      return { path: mutation.path, kind: { type: 'replace', value: omitKeys(kind.value, hidden) } }
    // anything else aimed at the root is not understood, so none of it is sent
    return undefined
  }
  return hidden.has(String(path[0])) ? undefined : mutation
}
