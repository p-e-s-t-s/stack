// Journals the file changes of one import (docs/undo-file-operations.md §2.1, §2.6). One recorder
// per item and batch: the first file placed is the operation users undo; files it replaced and
// the sidecars that went with them are recorded as parts of it.

import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { MediaFile, MediaItem } from '@magpiejs/library'
import { findSidecars } from '@magpiejs/sidecars'
import type { Context } from 'cordis'
import { type FileSystem, type Placement, placeSafelyDetailed, recycle } from './files'
import type { Journal } from './journal'
import type { OperationMethod, OperationSnapshot } from './schema'
import type { UndoService } from './undo'

export interface RecorderOptions {
  batchId?: string
  targetId?: number | null
  /** Where replaced files go: the user's recycle bin, else Magpie's trash, else nowhere. */
  bin: string
  /** Record operations; when false the recorder only performs them. */
  journaling: boolean
}

const exists = (fs: FileSystem, path: string) =>
  fs.stat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false
      throw e
    },
  )

export class Recorder {
  readonly batchId: string
  /** The operation the next replaced files belong to. */
  current?: number
  private targetId: number | null

  constructor(
    private ctx: Context,
    private journal: Journal,
    private undo: UndoService,
    private fs: FileSystem,
    readonly item: MediaItem,
    private options: RecorderOptions,
  ) {
    this.batchId = options.batchId ?? randomUUID()
    this.targetId = options.targetId ?? null
  }

  /** Where replaced files go. */
  get bin() {
    return this.options.bin
  }

  /** Whether anything was recorded. */
  get used() {
    return this.options.journaling && this.journal.batch(this.batchId).length > 0
  }

  private snapshotOf(path: string, file?: MediaFile): OperationSnapshot | undefined {
    const folder = this.ctx.library.folderOf(this.item)
    const row =
      file ??
      this.ctx.library
        .files(this.item.id)
        .find((f) => resolve(join(folder, f.path)) === resolve(path))
    if (!row) return undefined
    const { id: _id, addedAt: _added, ...values } = row
    return { file: values, extra: this.undo.hooksFor(this.item.kind)?.capture?.(this.item, row) }
  }

  /** Journals the operation that is about to place `dest`; returns its id. */
  begin(op: { source: string; dest: string; method: OperationMethod; replacing: boolean }) {
    if (!this.options.journaling) return undefined
    const entry = this.journal.begin({
      batchId: this.batchId,
      mediaId: this.item.id,
      targetId: this.targetId,
      type: op.replacing ? 'replace' : 'place',
      source: op.source,
      dest: op.dest,
      method: op.method,
      snapshot: op.replacing ? this.snapshotOf(op.dest) : undefined,
    })
    this.current = entry.id
    return entry.id
  }

  /** Notes something for the kind's undo hook about the import in progress. */
  annotate(note: unknown) {
    if (this.options.journaling && this.current !== undefined)
      this.journal.annotate(this.current, note)
  }

  /** The operation finished. */
  async finish(
    id: number | undefined,
    result: { trashPath?: string | null; method?: OperationMethod },
  ) {
    if (id !== undefined) await this.journal.complete(id, result)
  }

  /** The operation did not happen. */
  fail(id: number | undefined, error: unknown) {
    if (id !== undefined)
      this.journal.abandon(id, error instanceof Error ? error.message : String(error))
  }

  /** Places a file as `placeSafelyDetailed` does, recording it. */
  async place(source: string, dest: string, mode: OperationMethod): Promise<Placement['method']> {
    if (!this.options.journaling || resolve(source) === resolve(dest))
      return (await placeSafelyDetailed(source, dest, mode, this.options.bin, this.fs)).method
    const id = this.begin({
      source,
      dest,
      method: mode,
      replacing: await exists(this.fs, dest),
    })
    let placement: Placement
    try {
      placement = await placeSafelyDetailed(source, dest, mode, this.options.bin, this.fs)
    } catch (error) {
      this.fail(id, error)
      throw error
    }
    await this.finish(id, { trashPath: placement.previous, method: placement.method })
    return placement.method
  }

  /**
   * Takes a replaced file out of the way (recycle bin, trash or deleted), with the sidecars
   * that belong to it, recording each as part of the current operation.
   */
  async recycle(path: string, file?: MediaFile) {
    if (!this.options.journaling) {
      await recycle(path, this.options.bin, this.fs)
      return
    }
    const snapshot = this.snapshotOf(path, file)
    const entry = this.journal.begin({
      batchId: this.batchId,
      parentId: this.current ?? null,
      mediaId: this.item.id,
      targetId: this.targetId,
      type: 'delete',
      dest: path,
      snapshot,
    })
    const parent = this.current ?? entry.id
    // the sidecars are listed first, while they still sit next to the video
    const sidecars = await findSidecars(path, (dir) => this.fs.readdir(dir))
    let trash: string | null
    try {
      trash = await recycle(path, this.options.bin, this.fs)
    } catch (error) {
      this.fail(entry.id, error)
      throw error
    }
    if (trash === null) this.fail(entry.id, 'the file was already gone')
    else await this.journal.complete(entry.id, { trashPath: trash, fingerprint: false })
    for (const sidecar of sidecars) await this.recycleSidecar(sidecar, parent)
  }

  private async recycleSidecar(path: string, parentId: number) {
    const entry = this.journal.begin({
      batchId: this.batchId,
      parentId,
      mediaId: this.item.id,
      targetId: this.targetId,
      type: 'delete',
      dest: path,
    })
    try {
      const trash = await recycle(path, this.options.bin, this.fs)
      if (trash === null) this.fail(entry.id, 'the file was already gone')
      else await this.journal.complete(entry.id, { trashPath: trash, fingerprint: false })
    } catch (error) {
      // a subtitle that cannot be moved must not fail the import
      this.fail(entry.id, error)
      this.ctx.logger.warn('could not move %s out of the way: %s', path, (error as Error).message)
    }
  }
}
