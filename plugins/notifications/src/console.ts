// Web console entry: the Notifications settings page (destinations and recent activity).

import type {} from '@magpiejs/webui'
import type { TestResult } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { Destination, NotificationsService } from './index'
import type { LogEntry } from './schema'

export interface NotificationsData {
  destinations: Destination[]
  log: LogEntry[]
  test(id: string): Promise<TestResult>
}

export default function console_(ctx: Context, notifications: NotificationsService) {
  const snapshot = () => ({
    destinations: notifications.destinations(),
    log: notifications.recent(),
  })
  const refresh = ctx.debounce(() => entry.mutate((d) => Object.assign(d, snapshot())), 200)
  ctx.on('notifications/changed', refresh)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/notifications'],
    },
    {
      ...snapshot(),
      test: (id: string) => notifications.test(id),
    } satisfies NotificationsData,
  )
}
