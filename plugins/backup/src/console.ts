// Web console entry: System → Backups.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { BackupFile, BackupService, Settings, Staged } from './index'

export interface BackupData {
  settings: Settings
  backups: BackupFile[]
  /** A restore that completes on the next start. */
  staged: Staged | null
  /** Why the last backup failed, if it did. */
  error: string | null
  /** Set when the database lives in memory and there is nothing to back up. */
  unavailable: boolean
  save(input: Partial<Settings>): Promise<void>
  create(): Promise<void>
  remove(name: string): Promise<void>
  restore(name: string, config: boolean): Promise<Staged>
  cancelRestore(): Promise<void>
}

export default function console_(ctx: Context, backup: BackupService) {
  const snapshot = () => ({
    settings: backup.settings(),
    backups: backup.list(),
    staged: backup.staged(),
    error: backup.lastError?.message ?? null,
  })
  ctx.on('backup/changed', () => entry.mutate((d) => Object.assign(d, snapshot())))

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/system/backups'],
    },
    {
      ...snapshot(),
      unavailable: !backup.dir,
      async save(input) {
        backup.save(input)
      },
      async create() {
        await backup.create('manual')
      },
      async remove(name) {
        backup.remove(name)
      },
      restore: (name, config) => backup.restore(name, { config }),
      async cancelRestore() {
        backup.cancelRestore()
      },
    } satisfies BackupData,
  )
}
