import { describe, expect, it } from 'vitest'
import { activePage, isSettings, navigation, type NavPage } from '../app/shell/navigation'
import type { PageNavigation } from '@magpiejs/console-kit'
const page = (path: string, nav?: PageNavigation, order = 0, disabled = false): NavPage => ({
  id: path,
  path,
  name: path,
  navigation: nav,
  order,
  disabled: () => disabled,
})
describe('plugin-owned navigation', () => {
  it('uses metadata rather than route names and preserves undeclared pages under Other', () => {
    const model = navigation([
      page('/settings/not-config', { group: 'library', icon: 'books' }, 10),
      page('/custom-config', { group: 'configuration' }),
      page('/custom-activity', { group: 'activity' }),
      page('/movies'),
      page('/hidden', { group: 'library' }, 99, true),
    ])
    expect(model.groups.map((g) => [g.name, g.pages.map((p) => p.path)])).toEqual([
      ['Library', ['/settings/not-config']],
      ['Activity', ['/custom-activity']],
      ['Other', ['/movies']],
    ])
    expect(model.settings[0]?.pages[0]?.path).toBe('/custom-config')
    expect(isSettings(model.destination)).toBe(true)
    expect(isSettings(model.groups[0]?.pages[0])).toBe(false)
  })
  it('uses declared defaults independently for Settings and landing', () => {
    const model = navigation([
      page('/first', { group: 'library' }, 100),
      page('/start', { group: 'library', default: true }, 1),
      page('/config-first', { group: 'configuration' }, 100),
      page('/preferences', { group: 'configuration', default: true }, 1),
    ])
    expect(model.landing?.path).toBe('/start')
    expect(model.destination?.path).toBe('/preferences')
  })
  it('falls back deterministically and ignores disabled defaults', () => {
    const model = navigation([
      page('/disabled', { group: 'configuration', default: true }, 200, true),
      page('/b', { group: 'configuration' }, 10),
      page('/a', { group: 'configuration' }, 10),
    ])
    expect(model.destination?.path).toBe('/a')
    expect(navigation([page('/health', { group: 'system' })]).destination?.path).toBe('/health')
    expect(navigation([]).groups).toEqual([])
    expect(navigation([]).settings).toEqual([])
    expect(navigation([]).destination).toBeUndefined()
    expect(navigation([]).landing).toBeUndefined()
  })
  it('matches declared aliases and longest prefixes without guessing singular names', () => {
    const pages = [
      page('/catalog', { group: 'library', aliases: ['/item'] }),
      page('/catalog/special', { group: 'library' }),
      page('/movies', { group: 'other' }),
    ]
    expect(activePage(pages, '/item/1')?.path).toBe('/catalog')
    expect(activePage(pages, '/catalog/add')?.path).toBe('/catalog')
    expect(activePage(pages, '/catalog/special/1')?.path).toBe('/catalog/special')
    expect(activePage(pages, '/items/1')).toBeUndefined()
    expect(activePage(pages, '/movie/1')).toBeUndefined()
    expect(activePage(pages, '/catalog-extra')).toBeUndefined()
  })
})
