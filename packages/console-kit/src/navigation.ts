export interface PageNavigation {
  group: 'library' | 'activity' | 'configuration' | 'system' | 'other'
  /**
   * Heading within Settings for pages in the `configuration` group. Pages without one are
   * listed first, under General.
   */
  section?: 'library' | 'sources' | 'connections' | 'advanced'
  icon?: string
  /** Preferred destination within primary navigation or Settings. */
  default?: boolean
  /** Additional route prefixes belonging to this page, e.g. a singular detail route. */
  aliases?: readonly string[]
}

export interface NavPage {
  id: string
  path: string
  name: string
  order?: number
  navigation?: PageNavigation
  disabled: () => boolean | undefined
}

export function href(page: NavPage) {
  return page.path.replace(/:.+/, '')
}

export function isSettings(page: NavPage | undefined) {
  return page?.navigation?.group === 'configuration' || page?.navigation?.group === 'system'
}

/** Headings of the `configuration` group in Settings, in display order. */
const SECTIONS: [NonNullable<PageNavigation['section']> | undefined, string][] = [
  [undefined, 'General'],
  ['library', 'Library'],
  ['sources', 'Sources'],
  ['connections', 'Connections'],
  ['advanced', 'Advanced'],
]

/** A page without a known section is listed under General, so it never disappears. */
function sectionOf(page: NavPage) {
  const section = page.navigation?.section
  return SECTIONS.some(([known]) => known === section) ? section : undefined
}

export function navigation<T extends NavPage>(registered: T[]) {
  const pages = registered
    .filter((page) => !page.disabled())
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || a.id.localeCompare(b.id))
  const group = (name: string, key: PageNavigation['group']) => ({
    name,
    pages: pages.filter((page) => (page.navigation?.group ?? 'other') === key),
  })
  const groups = [
    group('Library', 'library'),
    group('Activity', 'activity'),
    group('Other', 'other'),
  ].filter((group) => group.pages.length)
  const configuration = pages.filter((page) => page.navigation?.group === 'configuration')
  const settings = [
    ...SECTIONS.map(([section, name]) => ({
      name,
      pages: configuration.filter((page) => sectionOf(page) === section),
    })),
    group('System', 'system'),
  ].filter((group) => group.pages.length)
  const settingsPages = settings.flatMap((group) => group.pages)
  const primaryPages = groups.flatMap((group) => group.pages)
  const destination = settingsPages.find((page) => page.navigation?.default) ?? settingsPages[0]
  const landing = primaryPages.find((page) => page.navigation?.default) ?? primaryPages[0]
  return { groups, settings, destination, landing, pages }
}

export function activePage<T extends NavPage>(pages: T[], path: string) {
  return pages
    .flatMap((page) =>
      [href(page), ...(page.navigation?.aliases ?? [])].flatMap((base) =>
        path === base || (base !== '/' && path.startsWith(base.replace(/\/$/, '') + '/'))
          ? [{ page, length: base.length }]
          : [],
      ),
    )
    .sort((a, b) => b.length - a.length)[0]?.page
}
