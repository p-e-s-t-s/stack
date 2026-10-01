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
