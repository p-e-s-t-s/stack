// File operations for importing: finding the video, hardlink/copy/move, recycle bin.

import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

export const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.m4v',
  '.avi',
  '.ts',
  '.m2ts',
  '.wmv',
  '.mov',
  '.webm',
  '.mpg',
  '.mpeg',
])

/** Filesystem calls, injectable so tests can simulate a cross-device link. */
export const fileSystem = {
  link: fs.link,
  copyFile: fs.copyFile,
  rename: fs.rename,
  unlink: fs.unlink,
  mkdir: fs.mkdir,
  stat: fs.stat,
  readdir: fs.readdir,
}
export type FileSystem = typeof fileSystem

/**
 * The files of a download with one of these extensions, largest first. A path that is itself
 * such a file gives just that file. `skipExtras` leaves out samples and extras folders (video).
 */
export async function findFiles(
  path: string,
  extensions: ReadonlySet<string>,
  options: { skipExtras?: boolean } = {},
  fsx: FileSystem = fileSystem,
): Promise<{ path: string; size: number }[]> {
  const stat = await fsx.stat(path)
  if (stat.isFile())
    return extensions.has(extname(path).toLowerCase()) ? [{ path, size: stat.size }] : []
  const candidates: { path: string; size: number }[] = []
  const walk = async (dir: string, depth: number) => {
    for (const entry of await fsx.readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const extras = /^(samples?|extras|featurettes|behind the scenes|trailers?)$/i
        if (depth < 3 && !(options.skipExtras && extras.test(entry.name)))
          await walk(full, depth + 1)
      } else if (
        extensions.has(extname(entry.name).toLowerCase()) &&
        !(options.skipExtras && /(^|[._ -])sample([._ -]|$)/i.test(entry.name))
      ) {
        candidates.push({ path: full, size: (await fsx.stat(full)).size })
      }
    }
  }
  await walk(path, 0)
  return candidates.sort((a, b) => b.size - a.size)
}

/** The video files of a download (samples and extras skipped), largest first. */
export function findVideos(path: string, fsx: FileSystem = fileSystem) {
  return findFiles(path, VIDEO_EXTENSIONS, { skipExtras: true }, fsx)
}

/** The main video file of a download: the largest video that isn't a sample or an extra. */
export async function findVideo(path: string, fsx: FileSystem = fileSystem) {
  return (await findVideos(path, fsx))[0]
}

const CROSS_DEVICE = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'])

/**
 * Places `source` at `dest`: hardlink (torrents keep seeding) with a copy fallback, or a move
 * for usenet. Writes to a temporary name first, so `dest` only ever appears complete.
 * Returns how the file was transferred.
 */
export async function transfer(
  source: string,
  dest: string,
  mode: 'hardlink' | 'copy' | 'move',
  fsx: FileSystem = fileSystem,
): Promise<'hardlink' | 'copy' | 'move'> {
  await fsx.mkdir(dirname(dest), { recursive: true })
  const partial = `${dest}.magpie-partial`
  await fsx.unlink(partial).catch(() => {})
  let method: 'hardlink' | 'copy' | 'move' = mode
  if (mode === 'hardlink') {
    try {
      await fsx.link(source, partial)
    } catch (error) {
      if (!CROSS_DEVICE.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      method = 'copy'
    }
  }
  if (method === 'move') {
    try {
      await fsx.rename(source, partial)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await fsx.copyFile(source, partial, constants.COPYFILE_EXCL)
      await fsx.unlink(source)
    }
  }
  if (method === 'copy') await fsx.copyFile(source, partial, constants.COPYFILE_EXCL)
  await fsx.rename(partial, dest)
  return method
}

/** Moves a file into the recycle bin (keeping its folder name), or deletes it. */
export async function recycle(path: string, recycleBin: string, fsx: FileSystem = fileSystem) {
  if (!recycleBin) {
    await fsx.unlink(path).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    })
    return
  }
  const target = join(recycleBin, basename(dirname(path)), basename(path))
  await fsx.mkdir(dirname(target), { recursive: true })
  try {
    await fsx.rename(path, target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    if (code !== 'EXDEV') throw error
    await fsx.copyFile(path, target)
    await fsx.unlink(path)
  }
}
