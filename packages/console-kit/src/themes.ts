// The theme contract that does not need Vue: part and region names, and how a part is
// picked from what themes have registered (docs/themes.md §4). The Vue side (registerTheme,
// themed, Region) lives in client/theme.

/** Props a theme part receives. Kind plugins pass these to the console-kit components. */
export interface ThemeParts {
  /** The page frame: navigation, regions and the routed page (default slot). */
  shell: Record<string, never>
  /** The Settings heading, its navigation and the page frame (default slot). */
  'settings.layout': Record<string, never>
  /** A library list: heading, filter, summary, card grid (`MediaCardGrid`). */
  'media.list': Record<string, unknown>
  /** A media detail header and body (`MediaDetailShell`). */
  'media.detail': Record<string, unknown>
  /** The add flow: search, options, results (`AddMediaFlow`). */
  'media.add': Record<string, unknown>
}

export type ThemePartName = keyof ThemeParts

/** Where plugins can put small widgets; the shell decides where each one sits. */
export interface ThemeRegions {
  /** Above the routed page. Empty by default. */
  'shell.topbar': true
  /** Settings link, Log out. */
  'shell.nav-foot': true
  /** Banners: the offline notice, anything a plugin needs to say everywhere. */
  'shell.notices': true
}

export type ThemeRegionName = keyof ThemeRegions

/** The theme every chain ends in; its parts are the built-in components. */
export const DEFAULT_THEME = 'default'

/** Slot type for a region. */
export const regionSlot = (name: string) => `region:${name}`

/** Something a theme registered for a part: the registering theme's id, or none for built-ins. */
export interface PartCandidate {
  theme?: string
  disabled?: () => boolean | undefined
}

/**
 * The registration that wins for a part: the one from the earliest theme in `chain` (most
 * specific first). Registrations from themes outside the chain, and disabled ones, never win;
 * `skip` lets a caller drop one that failed to render. Returns undefined when the built-in
 * default should render.
 */
export function selectPart<T extends PartCandidate>(
  candidates: readonly T[],
  chain: readonly string[],
  skip?: (candidate: T) => boolean,
): T | undefined {
  let best: T | undefined
  let bestRank = Infinity
  for (const candidate of candidates) {
    if (candidate.disabled?.() || skip?.(candidate)) continue
    const rank = chain.indexOf(candidate.theme ?? DEFAULT_THEME)
    if (rank === -1 || rank >= bestRank) continue
    best = candidate
    bestRank = rank
  }
  // a registration for the default theme itself is the built-in: let the caller render it
  return best && (best.theme ?? DEFAULT_THEME) === DEFAULT_THEME ? undefined : best
}
