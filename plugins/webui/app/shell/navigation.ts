import type { PageNavigation } from '@magpiejs/console-kit'

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
  const settings = [group('Configuration', 'configuration'), group('System', 'system')].filter(
    (group) => group.pages.length,
  )
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
