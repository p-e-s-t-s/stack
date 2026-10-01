// Asking the server which themes apply to this user. The console does it once at start (the
// shell), and again whenever the server says something changed (`version` in the entry data).

export interface ThemeInfo {
  id: string
  name: string
  description?: string
  extends?: string
  swatch?: string[]
  available: boolean
}

export interface ThemesState {
  themes: ThemeInfo[]
  default: string
  mine: string | null
  chain: string[]
}

export async function fetchThemes(): Promise<ThemesState> {
  const res = await fetch('/themes', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`could not load themes (${res.status})`)
  return res.json()
}

/** PUT a choice; returns the chain that now applies, or throws with the server's message. */
export async function choose(path: '/themes/me' | '/themes/default', id: string | null) {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? `could not save (${res.status})`)
  return body.chain as string[]
}
