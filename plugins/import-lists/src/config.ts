// Settings every list shares. List plugins spread `listConfig` into their own `Config` and
// pass `settingsOf(config)` to `ctx.importLists.register`.

import z from 'schemastery'

export interface ListConfig {
  name: string
  profileId: number
  rootFolderId: number
  monitor: boolean
  search: boolean
  intervalHours: number
}

export const listConfig = {
  name: z.string().default('List').description('Name shown in Magpie.'),
  profileId: z.natural().default(1).description('Quality profile for titles this list adds.'),
  rootFolderId: z.natural().default(1).description('Root folder for titles this list adds.'),
  monitor: z.boolean().default(true).description('Monitor the titles it adds.'),
  search: z.boolean().default(true).description('Search for downloads when a title is added.'),
  intervalHours: z
    .natural()
    .min(1)
    .default(12)
    .description('Hours between syncs (at least 1, to be kind to the source).'),
}

export function settingsOf(config: ListConfig) {
  return {
    profileId: config.profileId,
    rootFolderId: config.rootFolderId,
    monitor: config.monitor,
    search: config.search,
    intervalHours: Math.max(1, config.intervalHours),
  }
}

/** `<type>:<loader entry id>`, so the settings page can match a running list to its entry. */
export function listIdOf(ctx: { fiber: unknown }, type: string, fallback: string) {
  const entry = (ctx.fiber as { entry?: { options: { id: string } } }).entry
  return `${type}:${entry?.options.id ?? fallback}`
}
