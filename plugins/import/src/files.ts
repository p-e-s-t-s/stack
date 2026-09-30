// File operations for importing: finding the video, hardlink/copy/move, recycle bin.

import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
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
  options: { skipExtras?: boolean; maxDepth?: number } = {},
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
        if (options.skipExtras && extras.test(entry.name)) continue
        if (depth >= (options.maxDepth ?? 3)) {
          if (options.maxDepth !== undefined) throw new Error(`scan depth exceeded at ${full}`)
          continue
        }
        await walk(full, depth + 1)
      } else if (
        entry.isFile() &&
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

/** What `placeSafely` did: how the file was transferred, and what became of an existing file. */
export interface Placement {
  method: 'hardlink' | 'copy' | 'move'
  /**
   * `undefined` when nothing was at the destination; otherwise where the replaced file went
   * (`null` when it was deleted).
   */
  previous?: string | null
}

/** Stage an incoming file before moving an existing destination out of the way. */
export async function placeSafelyDetailed(
  source: string,
  dest: string,
  mode: 'hardlink' | 'copy' | 'move',
  recycleBin: string,
  fsx: FileSystem = fileSystem,
): Promise<Placement> {
  const exists = await fsx.stat(dest).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false
      throw e
    },
  )
  if (!exists) return { method: await transfer(source, dest, mode, fsx) }
  if (source === dest) return { method: mode, previous: undefined }
  const staged = `${dest}.magpie-incoming-${randomUUID()}`
  const backup = `${staged}.previous`
  const method = await transfer(source, staged, mode === 'move' ? 'copy' : mode, fsx)
  await fsx.rename(dest, backup)
  try {
    await fsx.rename(staged, dest)
  } catch (error) {
    await fsx.rename(backup, dest)
    await fsx.unlink(staged).catch(() => {})
    throw error
  }
  const previous = await recycle(backup, recycleBin, fsx, dest)
  if (mode === 'move') await fsx.unlink(source)
  return { method: mode === 'move' ? 'move' : method, previous }
}

/** Like `placeSafelyDetailed`, for callers that only need to know how the file was transferred. */
export async function placeSafely(
  source: string,
  dest: string,
  mode: 'hardlink' | 'copy' | 'move',
  recycleBin: string,
  fsx: FileSystem = fileSystem,
) {
  return (await placeSafelyDetailed(source, dest, mode, recycleBin, fsx)).method
}

/** Renames a file, copying across devices; the destination's folder is created. */
export async function moveFile(from: string, to: string, fsx: FileSystem = fileSystem) {
  await fsx.mkdir(dirname(to), { recursive: true })
  try {
    await fsx.rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fsx.copyFile(from, to, constants.COPYFILE_EXCL)
    await fsx.unlink(from)
  }
}

/**
 * Moves a file into the recycle bin (keeping its folder name), or deletes it. Returns where it
 * went: `null` when it was deleted or was already gone.
 */
export async function recycle(
  path: string,
  recycleBin: string,
  fsx: FileSystem = fileSystem,
  originalPath = path,
): Promise<string | null> {
  if (!recycleBin) {
    await fsx.unlink(path).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    })
    return null
  }
  let target = join(recycleBin, basename(dirname(originalPath)), basename(originalPath))
  const exists = await fsx.stat(target).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false
      throw e
    },
  )
  if (exists) target += `.${randomUUID()}`
  try {
    await moveFile(path, target, fsx)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return target
}

/**
 * Size, modification time and a short hash (the first and last 64 KiB) of a file: enough to
 * tell whether it is still the file an operation produced without reading all of it.
 */
export async function fingerprintFile(path: string): Promise<string> {
  const handle = await fs.open(path, 'r')
  try {
    const { size, mtimeMs } = await handle.stat()
    const hash = createHash('sha1')
    const chunk = Buffer.alloc(65536)
    for (const position of size > 131072 ? [0, size - 65536] : [0]) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      hash.update(chunk.subarray(0, bytesRead))
    }
    return `${size}:${mtimeMs}:${hash.digest('hex').slice(0, 16)}`
  } finally {
    await handle.close()
  }
}
