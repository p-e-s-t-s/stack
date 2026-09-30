// Settings every notifier shares: which events it wants. Notifier plugins spread
// `eventConfig` into their own `Config` and pass `eventsOf(config)` as `Notifier.events`.

import z from 'schemastery'

export interface EventConfig {
  onImported: boolean
  onUpgraded: boolean
  onFailed: boolean
  onGrabbed: boolean
}

export const eventConfig = {
  onImported: z.boolean().default(true).description('Tell me when a download is imported.'),
  onUpgraded: z
    .boolean()
    .default(true)
    .description('Tell me when a file is replaced by a better one.'),
  onFailed: z.boolean().default(true).description('Tell me when a download or an import fails.'),
  onGrabbed: z
    .boolean()
    .default(false)
    .description('Tell me when a release is sent to a download client.'),
}

export function eventsOf(config: EventConfig): string[] {
  const events: string[] = []
  if (config.onImported) events.push('media.imported')
  if (config.onUpgraded) events.push('media.upgraded')
  if (config.onFailed) events.push('import.failed', 'download.failed')
  if (config.onGrabbed) events.push('download.grabbed')
  return events
}
