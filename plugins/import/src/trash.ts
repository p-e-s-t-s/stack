// Magpie's own trash for replaced files (docs/undo-file-operations.md §2.3) and the job that
// empties it. Only files inside the trash directory are ever removed: a recycle bin the user
// set is theirs, so operations that used one expire but their files stay.

import { readdir, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import type { Context } from 'cordis'
import type { Journal, Operation } from './journal'

const DAY = 24 * 60 * 60_000

export const inside = (root: string, path: string) => {
  const rel = relative(resolve(root), resolve(path))
  return (
    !!rel &&
    rel !== '..' &&
    !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
    !isAbsolute(rel)
  )
}

async function removeFile(trashDir: string, path: string) {
  await rm(path, { force: true })
  // empty folders left behind go with it, up to the trash itself
  for (let dir = dirname(path); inside(trashDir, dir); dir = dirname(dir)) {
    try {
      await rmdir(dir)
    } catch {
      break
    }
  }
}

export interface PurgeResult {
  expired: number
  removed: number
  freedBytes: number
}

/**
 * Expires operations that are too old or no longer fit the size cap, deleting the files they
 * parked in Magpie's trash. Expiring one operation expires everything that belongs to it.
 */
export async function purge(
  ctx: Context,
  journal: Journal,
  trashDir: string,
  now = Date.now(),
): Promise<PurgeResult> {
  const settings = ctx.library.fileHandling()
  const result: PurgeResult = { expired: 0, removed: 0, freedBytes: 0 }

  const expire = async (root: Operation) => {
    const group = [root, ...journal.children(root.id)]
    for (const op of group) {
      if (op.status !== 'applied' && op.status !== 'undo_failed') continue
      journal.setStatus(op.id, 'expired', {
        error: op.error && op.status === 'undo_failed' ? op.error : null,
      })
      result.expired++
      if (op.trashPath && inside(trashDir, op.trashPath)) {
        await removeFile(trashDir, op.trashPath)
        result.removed++
        result.freedBytes += op.trashSize ?? 0
      }
    }
  }
  const rootOf = (op: Operation) => (op.parentId ? journal.get(op.parentId) : op)

  // everything expires when undo is off, otherwise by age
  const cutoff =
    settings.undoRetentionDays > 0
      ? now - settings.undoRetentionDays * DAY
      : Number.MAX_SAFE_INTEGER
  for (const op of journal.olderThan(cutoff)) {
    const root = rootOf(op)
    if (root) await expire(root)
  }

  // the cap: oldest parked files first
  if (settings.undoMaxGb > 0) {
    const cap = settings.undoMaxGb * 1024 ** 3
    const parked = journal
      .withTrash()
      .filter((op) => op.trashPath && inside(trashDir, op.trashPath))
    let total = parked.reduce((sum, op) => sum + (op.trashSize ?? 0), 0)
    for (const op of parked) {
      if (total <= cap) break
      const root = rootOf(op)
      if (!root) continue
      const before = result.freedBytes
      await expire(root)
      total -= result.freedBytes - before
    }
  }

  // files in the trash nothing refers to (an import that crashed, a record that was deleted)
  const known = new Set(journal.withTrash().map((op) => resolve(op.trashPath!)))
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        await rmdir(path).catch(() => {})
      } else if (!known.has(resolve(path))) {
        const info = await stat(path).catch(() => undefined)
        // a day since it last changed (a rename counts) covers a file whose record is still
        // being written
        if (info && now - Math.max(info.mtimeMs, info.ctimeMs) > DAY) {
          await rm(path, { force: true })
          result.removed++
          result.freedBytes += info.size
        }
      }
    }
  }
  await walk(trashDir)
  return result
}
