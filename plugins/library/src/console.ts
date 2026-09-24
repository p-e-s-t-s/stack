// Web console entry: Media management (root folders, naming per kind, file handling).

import type {} from '@magpiejs/webui'
import type { MediaKind } from '@magpiejs/types'
import type { Context } from 'cordis'
import type { FileHandling, KindInfo, LibraryService, RootFolder } from './index'

export interface KindSettings extends KindInfo {
  naming?: {
    templates: { key: string; label: string; help?: string }[]
    tokens: string[]
  }
}

export interface LibraryData {
  kinds: KindSettings[]
  rootFolders: RootFolder[]
  /** Naming templates by kind. */
  naming: Record<string, Record<string, string>>
  files: FileHandling
  addRootFolder(path: string, kind: MediaKind): Promise<void>
  removeRootFolder(id: number): Promise<void>
  saveNaming(kind: MediaKind, values: Record<string, string>): Promise<void>
  saveFiles(files: FileHandling): Promise<void>
}

export default function console_(ctx: Context, library: LibraryService) {
  const snapshot = () => {
    const kinds = library.kinds()
    return {
      kinds: kinds.map((k): KindSettings => {
        const scheme = library.namingScheme(k.id)
        return {
          ...k,
          naming: scheme && {
            templates: Object.entries(scheme.templates).map(([key, t]) => ({
              key,
              label: t.label,
              help: t.help,
            })),
            tokens: scheme.tokens,
          },
        }
      }),
      rootFolders: library.rootFolders(),
      naming: Object.fromEntries(kinds.map((k) => [k.id, library.naming(k.id)])),
      files: library.fileHandling(),
    }
  }
  const refresh = () => entry.mutate((d) => Object.assign(d, snapshot()))
  ctx.on('library/kinds', refresh)

  const data: LibraryData = {
    ...snapshot(),
    async addRootFolder(path, kind) {
      if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path))
        throw new Error('use an absolute path')
      if (!library.kinds().some((k) => k.id === kind)) throw new Error(`unknown kind ${kind}`)
      library.addRootFolder(path, kind)
      refresh()
    },
    async removeRootFolder(id) {
      library.removeRootFolder(id)
      refresh()
    },
    async saveNaming(kind, values) {
      library.saveNaming(kind, values)
      refresh()
    },
    async saveFiles(files) {
      library.saveFileHandling(files)
      refresh()
    },
  }

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/media'],
    },
    data,
  )
}
