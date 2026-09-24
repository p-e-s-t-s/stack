// Web console entry: Media management (root folders, naming, file handling).

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { LibraryService, Naming, RootFolder } from './index'

export interface LibraryData {
  rootFolders: RootFolder[]
  naming: Naming
  addRootFolder(path: string, kind: 'movie' | 'series'): Promise<void>
  removeRootFolder(id: number): Promise<void>
  saveNaming(naming: Naming): Promise<void>
}

export default function console_(ctx: Context, library: LibraryService) {
  const refresh = () =>
    entry.mutate((d) => {
      d.rootFolders = library.rootFolders()
      d.naming = library.naming()
    })

  const data: LibraryData = {
    rootFolders: library.rootFolders(),
    naming: library.naming(),
    async addRootFolder(path, kind) {
      if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path))
        throw new Error('use an absolute path')
      library.addRootFolder(path, kind)
      refresh()
    },
    async removeRootFolder(id) {
      library.removeRootFolder(id)
      refresh()
    },
    async saveNaming(naming) {
      library.saveNaming(naming)
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
