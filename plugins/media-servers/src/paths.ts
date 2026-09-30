// Translating Magpie's library paths into the paths a media server sees (they differ when
// either side runs in a container or on another OS). Not the download clients' paths.

export interface Mapping {
  from: string
  to: string
}

const WINDOWS = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\)/

const isWindows = (path: string) => WINDOWS.test(path)

function segments(path: string) {
  const parts = path.split(isWindows(path) ? /[\\/]+/ : /\/+/).filter(Boolean)
  if (parts.includes('..')) throw new Error(`"${path}" has a ".." in it`)
  return parts.filter((part) => part !== '.')
}

/** `D:\Media => /media; /data/tv => /tv`. */
export function parseMappings(text: string): Mapping[] {
  const mappings: Mapping[] = []
  for (const entry of text.split(';')) {
    if (!entry.trim()) continue
    const [from, to, ...extra] = entry.split('=>').map((s) => s.trim())
    if (!from || !to || extra.length)
      throw new Error(`"${entry.trim()}" is not a mapping; write it as "from => to"`)
    segments(from)
    segments(to)
    const key = keyOf(from)
    if (mappings.some((m) => keyOf(m.from) === key))
      throw new Error(`"${from}" is mapped more than once`)
    mappings.push({ from, to })
  }
  return mappings
}

const keyOf = (path: string) => {
  const parts = segments(path)
  return (isWindows(path) ? parts.map((p) => p.toLowerCase()) : parts).join('/')
}

/**
 * The server's path for one of Magpie's, by the longest mapping whose folders are a prefix
 * (whole folders only: `/Movies` does not match `/MoviesExtra`). Windows-style sources ignore
 * case. With no mappings the path is unchanged; with mappings, a path none of them covers is
 * undefined. The result uses the separators of the mapping's target.
 */
export function mapPath(path: string, mappings: Mapping[]): string | undefined {
  if (!mappings.length) return path
  const windows = isWindows(path)
  const parts = segments(path)
  let best: { mapping: Mapping; length: number } | undefined
  for (const mapping of mappings) {
    if (isWindows(mapping.from) !== windows) continue
    const from = segments(mapping.from)
    const same = from.every((part, i) =>
      windows ? part.toLowerCase() === parts[i]?.toLowerCase() : part === parts[i],
    )
    if (same && (!best || from.length > best.length)) best = { mapping, length: from.length }
  }
  if (!best) return
  const target = best.mapping.to
  const rest = [...segments(target), ...parts.slice(best.length)]
  if (isWindows(target)) {
    const joined = rest.join('\\')
    if (target.startsWith('\\\\')) return `\\\\${joined}`
    return rest.length === 1 ? `${joined}\\` : joined
  }
  return `/${rest.join('/')}`
}

/** True when `path` is `root` or inside it: whole folders, either separator, any case. */
export function isInside(path: string, root: string) {
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean)
  const a = split(path.toLowerCase())
  return split(root.toLowerCase()).every((part, i) => a[i] === part)
}
