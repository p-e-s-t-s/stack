// Undo (docs/undo-file-operations.md §2.2): reverses journaled file operations, then lets the
// kind plugin put its records back. Every check runs before anything is touched, so an undo
// that cannot be done leaves things exactly as they were.

import { basename, dirname, join, resolve } from 'node:path'
import type { Context } from 'cordis'
import type { MediaFile, MediaItem } from '@magpiejs/library'
import type { MediaKind } from '@magpiejs/types'
import { type FileSystem, fingerprintFile, moveFile } from './files'
import type { Journal, Operation } from './journal'

/** How a kind of media gets its own records back; `import` knows nothing about them. */
export interface UndoHooks {
  /** Kind-specific state worth keeping about a library file that is about to go (JSON). */
  capture?(item: MediaItem, file: MediaFile): unknown
  /** A file record that an undo put back; relink whatever the kind links to files. */
  restore?(item: MediaItem, file: MediaFile, extra: unknown): void
  /** An import was undone; `note` is what the importer recorded about it. */
  rollback?(item: MediaItem, note: unknown): void
  /** Records of the item changed because of an undo. */
  changed?(item: MediaItem): void
}

/** Why an undo was refused, in words for the user. */
export class UndoError extends Error {}

export interface UndoOutcome {
  id: number
  path: string
  ok: boolean
  /** Why it could not be undone. */
  reason?: string
  /** Parts that were left alone (a subtitle the user changed). */
  warnings: string[]
}

/** What to undo: one import, or every import of a batch (a season pack, a review commit). */
export interface UndoTarget {
  operationId?: number
  batchId?: string
}

/** How the undo button for a target should look. */
export interface UndoState {
  state: 'available' | 'undone' | 'unavailable'
  /** Why it is unavailable. */
  reason?: string
  /** How many imports it would undo. */
  count: number
}

const exists = (fs: FileSystem, path: string) =>
  fs.stat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false
      throw e
    },
  )

export class UndoService {
  private hooks = new Map<MediaKind, UndoHooks>()

  constructor(
    private ctx: Context,
    private journal: Journal,
    private lock: <T>(id: number, action: () => Promise<T>) => Promise<T>,
  ) {}

  private get fs() {
    return this.journal.fs
  }

  register(kind: MediaKind, hooks: UndoHooks) {
    return this.ctx.effect(() => {
      this.hooks.set(kind, hooks)
      return () => this.hooks.delete(kind)
    }, `import.registerUndo(${kind})`)
  }

  hooksFor(kind: MediaKind) {
    return this.hooks.get(kind)
  }

  /** The top-level operation and everything that belongs to it, newest first. */
  private group(root: Operation) {
    return [root, ...this.journal.children(root.id)].sort((a, b) => b.id - a.id)
  }

  /** Whether an operation can be undone right now; the reason if not. Touches nothing. */
  async check(
    id: number,
    options: { force?: boolean } = {},
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.preflight(this.root(id), options)
      return { ok: true }
    } catch (error) {
      if (error instanceof UndoError) return { ok: false, reason: error.message }
      throw error
    }
  }

  private root(id: number) {
    const op = this.journal.get(id)
    if (!op) throw new UndoError('this operation is no longer recorded')
    if (op.parentId) throw new UndoError('undo the whole import, not a part of it')
    return op
  }

  private async preflight(root: Operation, options: { force?: boolean }) {
    switch (root.status) {
      case 'applied':
      case 'undo_failed':
        break
      case 'undone':
        throw new UndoError('already undone')
      case 'expired':
        throw new UndoError('too old to undo: the replaced files were cleared from the trash')
      case 'pending':
        throw new UndoError('the import is still running')
      default:
        throw new UndoError('nothing was changed')
    }
    // the import's own files must all be ready; subtitles are checked one by one later
    for (const op of this.group(root))
      if (op === root || op.snapshot?.file) await this.checkOne(op, options)
    for (const op of this.group(root)) {
      if (this.journal.newerTouching(root.id, op.dest, root.batchId).length)
        throw new UndoError(
          `${basename(op.dest)} was changed again afterwards; undo that change first`,
        )
    }
  }

  /** Checks one operation; throws an UndoError naming the problem. */
  private async checkOne(op: Operation, options: { force?: boolean }) {
    const name = basename(op.dest)
    if (op.type === 'place' || op.type === 'replace' || op.type === 'rename') {
      const present = await exists(this.fs, op.dest)
      if (present && op.fingerprint && !(options.force && op.type === 'rename')) {
        if ((await fingerprintFile(op.dest)) !== op.fingerprint)
          throw new UndoError(`${name} was changed after the import`)
      }
      if (!present && (op.method === 'move' || op.type === 'rename'))
        throw new UndoError(`${name} is no longer there`)
      if (op.method === 'move' || op.type === 'rename') {
        if (!op.source) throw new UndoError(`${name} has no recorded original location`)
        if (!(await exists(this.fs, dirname(op.source))))
          throw new UndoError(
            op.type === 'rename'
              ? `the folder ${dirname(op.source)} no longer exists`
              : `the download folder ${dirname(op.source)} no longer exists, so ${name} cannot be moved back`,
          )
        if (await exists(this.fs, op.source)) throw new UndoError(`${op.source} already exists`)
      }
    }
    if (op.type === 'replace' || op.type === 'delete') {
      if (!op.trashPath) throw new UndoError(`the previous ${name} was not kept`)
      if (!(await exists(this.fs, op.trashPath)))
        throw new UndoError(`the previous ${name} is no longer in the trash or recycle bin`)
    }
    if (op.type === 'delete' && (await exists(this.fs, op.dest)))
      throw new UndoError(`${op.dest} exists again`)
  }

  /** Undoes one import (an operation with its sidecars and replaced files). */
  async undo(id: number, options: { force?: boolean } = {}): Promise<UndoOutcome> {
    const root = this.root(id)
    return this.lock(root.mediaId, () => this.undoLocked(root.id, options))
  }

  private async undoLocked(id: number, options: { force?: boolean }): Promise<UndoOutcome> {
    const root = this.root(id)
    const outcome: UndoOutcome = { id, path: root.dest, ok: false, warnings: [] }
    try {
      await this.preflight(root, options)
    } catch (error) {
      if (error instanceof UndoError) return { ...outcome, reason: error.message }
      throw error
    }
    const item = this.ctx.library.get(root.mediaId)
    if (!item) return { ...outcome, reason: 'the item is no longer in the library' }
    const group = this.group(root)
    const restored: { op: Operation; file: NonNullable<Operation['snapshot']>['file'] }[] = []
    for (const op of group) {
      if (op !== root && op.status !== 'applied' && op.status !== 'undo_failed') continue
      if (op !== root && !op.snapshot?.file) {
        // a sidecar that changed or was replaced since stays where it is
        try {
          await this.checkOne(op, options)
        } catch (error) {
          if (!(error instanceof UndoError)) throw error
          this.journal.setStatus(op.id, 'undo_failed', { error: error.message })
          outcome.warnings.push(`${basename(op.dest)}: ${error.message}`)
          continue
        }
      }
      // recorded first, so an interruption leaves a record rather than a half-undone state
      this.journal.setStatus(op.id, 'undo_failed', { error: 'undo was interrupted' })
      try {
        await this.apply(op)
      } catch (error) {
        const reason = (error as Error).message
        this.journal.setStatus(op.id, 'undo_failed', { error: reason })
        this.ctx.logger.warn('undo of %s failed: %s', op.dest, reason)
        return { ...outcome, reason: `${basename(op.dest)}: ${reason}` }
      }
      this.journal.setStatus(op.id, 'undone', { undoneAt: Date.now() })
      if (op.snapshot?.file) restored.push({ op, file: op.snapshot.file })
    }
    this.records(item, root, restored)
    this.ctx.get('history')?.add(item.id, 'import-undone', basename(root.dest), {
      batchId: root.batchId,
      operationId: root.id,
      path: root.dest,
    })
    return { ...outcome, ok: true }
  }

  /** The file side of one operation. */
  private async apply(op: Operation) {
    const unlink = (path: string) =>
      this.fs.unlink(path).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
      })
    switch (op.type) {
      case 'place':
      case 'replace':
        if (op.method === 'move') await moveFile(op.dest, op.source!, this.fs)
        else await unlink(op.dest)
        if (op.type === 'replace') await moveFile(op.trashPath!, op.dest, this.fs)
        break
      case 'rename':
        await moveFile(op.dest, op.source!, this.fs)
        break
      case 'delete':
        await moveFile(op.trashPath!, op.dest, this.fs)
        break
    }
  }

  /** The record side: drop the file the import added, put back the ones it removed. */
  private records(
    item: MediaItem,
    root: Operation,
    restored: { op: Operation; file: NonNullable<Operation['snapshot']>['file'] }[],
  ) {
    const library = this.ctx.library
    const folder = library.folderOf(item)
    const hooks = this.hooks.get(item.kind)
    const back: { row: MediaFile; extra: unknown }[] = []
    library.db.transaction(() => {
      if (root.type === 'place' || root.type === 'replace') {
        for (const file of library.files(item.id))
          if (resolve(join(folder, file.path)) === resolve(root.dest)) library.removeFile(file.id)
      }
      for (const { op, file } of restored) {
        if (!file) continue
        const present = library
          .files(item.id)
          .some((f) => f.path === file.path && (f.targetId ?? null) === (file.targetId ?? null))
        if (!present) back.push({ row: library.addFile(file), extra: op.snapshot?.extra })
      }
    })
    // the kinds run their own transactions, so not inside the one above
    for (const { row, extra } of back) hooks?.restore?.(item, row, extra)
    if (root.snapshot?.note !== undefined) hooks?.rollback?.(item, root.snapshot.note)
    hooks?.changed?.(item)
  }

  /** Undoes every import of a batch, newest first, carrying on past the ones that cannot be. */
  async undoBatch(batchId: string, options: { force?: boolean } = {}): Promise<UndoOutcome[]> {
    const roots = this.journal
      .batch(batchId)
      .filter((op) => op.status === 'applied' || op.status === 'undo_failed')
      .sort((a, b) => b.id - a.id)
    const outcomes: UndoOutcome[] = []
    for (const op of roots) outcomes.push(await this.undo(op.id, options))
    return outcomes
  }

  private roots(target: UndoTarget) {
    if (target.operationId !== undefined) {
      const op = this.journal.get(target.operationId)
      return op && !op.parentId ? [op] : []
    }
    return target.batchId ? this.journal.batch(target.batchId) : []
  }

  /**
   * Whether a target can be undone, from the journal alone (nothing on disk is read, so this is
   * cheap enough for a list); `undo` still checks the files.
   */
  state(target: UndoTarget): UndoState {
    const roots = this.roots(target)
    if (!roots.length) return { state: 'unavailable', reason: 'not recorded', count: 0 }
    const live = roots.filter((op) => op.status === 'applied' || op.status === 'undo_failed')
    if (!live.length) {
      if (roots.every((op) => op.status === 'undone')) return { state: 'undone', count: 0 }
      const expired = roots.some((op) => op.status === 'expired')
      return {
        state: 'unavailable',
        reason: expired ? 'too old to undo' : 'nothing to undo',
        count: 0,
      }
    }
    const open = live.filter(
      (op) =>
        !this.group(op).some(
          (part) => this.journal.newerTouching(op.id, part.dest, op.batchId).length,
        ),
    )
    if (!open.length) return { state: 'unavailable', reason: 'changed again afterwards', count: 0 }
    return { state: 'available', count: open.length }
  }

  /** The files an undo would move, in words, and what stands in the way. */
  async plan(target: UndoTarget) {
    const lines: string[] = []
    const problems: string[] = []
    for (const root of this.roots(target)) {
      if (root.status !== 'applied' && root.status !== 'undo_failed') continue
      const check = await this.check(root.id)
      if (!check.ok) problems.push(`${basename(root.dest)}: ${check.reason}`)
      for (const op of this.group(root)) lines.push(this.describe(op))
    }
    return { lines, problems }
  }

  private describe(op: Operation) {
    const name = basename(op.dest)
    switch (op.type) {
      case 'place':
        return op.method === 'move'
          ? `Move ${name} back to ${op.source}`
          : `Remove ${op.dest} (the download is not touched)`
      case 'replace':
        return `Put the previous ${name} back (the new one is ${
          op.method === 'move' ? `moved to ${op.source}` : 'removed'
        })`
      case 'rename':
        return `Rename ${name} back to ${basename(op.source ?? '')}`
      case 'delete':
        return `Put ${op.dest} back`
    }
  }

  /** Undoes a target: one import, or every import of a batch. */
  async run(target: UndoTarget, options: { force?: boolean } = {}) {
    if (target.operationId !== undefined) return [await this.undo(target.operationId, options)]
    return this.undoBatch(target.batchId ?? '', options)
  }

  /** What undoing a batch would do: how many imports, how many can be undone, and why not. */
  async batchStatus(batchId: string) {
    const roots = this.journal.batch(batchId)
    const applied = roots.filter((op) => op.status === 'applied' || op.status === 'undo_failed')
    const checks = await Promise.all(
      applied.map(async (op) => ({ op, ...(await this.check(op.id)) })),
    )
    return {
      batchId,
      total: roots.length,
      undone: roots.filter((op) => op.status === 'undone').length,
      undoable: checks.filter((c) => c.ok).length,
      reasons: [...new Set(checks.filter((c) => !c.ok).map((c) => c.reason!))],
    }
  }
}
