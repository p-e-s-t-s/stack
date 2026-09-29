export interface PageNavigation {
  group: 'library' | 'activity' | 'configuration' | 'system' | 'other'
  icon?: string
  /** Preferred destination within primary navigation or Settings. */
  default?: boolean
  /** Additional route prefixes belonging to this page, e.g. a singular detail route. */
  aliases?: readonly string[]
}
