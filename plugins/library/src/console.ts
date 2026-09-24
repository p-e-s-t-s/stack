// Web console entry: Media management (root folders, naming, file handling).

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { MediaKind } from '@magpiejs/types'
import type { KindInfo, LibraryService, Naming, RootFolder } from './index'

export interface LibraryData {
  kinds: KindInfo[]
  rootFolders: RootFolder[]
  naming: Naming
  addRootFolder(path: string, kind: MediaKind): Promise<void>
  removeRootFolder(id: number): Promise<void>
  saveNaming(naming: Naming): Promise<void>
}

export default function console_(ctx: Context, library: LibraryService) {
  const refresh = () =>
    entry.mutate((d) => {
      d.kinds = library.kinds()
      d.rootFolders = library.rootFolders()
      d.naming = library.naming()
    })
  ctx.on('library/kinds', refresh)

  const data: LibraryData = {
    kinds: library.kinds(),
    rootFolders: library.rootFolders(),
    naming: library.naming(),
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
