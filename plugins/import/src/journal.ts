// The journal of file operations (docs/undo-file-operations.md §2.1): every change Magpie makes to
// a library file is recorded before it happens, so it can be reversed later. The journal only
// knows about files; the kind plugins restore their own records through undo hooks.

import { and, desc, eq, inArray, isNull, lt, lte } from 'drizzle-orm'
import type { Drizzle } from '@magpiejs/database'
import type { Context } from 'cordis'
import { type FileSystem, fileSystem, fingerprintFile } from './files'
import * as schema from './schema'

export type { Operation, OperationSnapshot, OperationStatus, OperationType } from './schema'

export interface NewOperation {
  batchId: string
  parentId?: number | null
  mediaId: number
  targetId?: number | null
  type: schema.OperationType
  source?: string | null
  dest: string
  method?: schema.OperationMethod | null
  snapshot?: schema.OperationSnapshot | null
}

export class Journal {
  constructor(
    readonly db: Drizzle<typeof schema>,
    private ctx: Context,
    private getFs: () => FileSystem = () => fileSystem,
  ) {}

  get fs() {
    return this.getFs()
  }

  /** Journals an operation that is about to happen. */
  begin(input: NewOperation) {
    return this.db
      .insert(schema.operations)
      .values({
        batchId: input.batchId,
        parentId: input.parentId ?? null,
        mediaId: input.mediaId,
        targetId: input.targetId ?? null,
        type: input.type,
        source: input.source ?? null,
        dest: input.dest,
        method: input.method ?? null,
        snapshot: input.snapshot ?? null,
        status: 'pending',
        createdAt: Date.now(),
      })
      .returning()
      .get()
  }

  /** The operation finished: record its fingerprint and where a replaced file went. */
  async complete(
    id: number,
    result: { trashPath?: string | null; method?: schema.OperationMethod; fingerprint?: boolean },
  ) {
    const op = this.get(id)!
    let trashSize: number | null = null
    if (result.trashPath) {
      trashSize = await this.fs.stat(result.trashPath).then(
        (s) => s.size,
        () => null,
      )
    }
    const fingerprint =
      result.fingerprint === false
        ? null
        : await fingerprintFile(op.dest).catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return null
            throw e
          })
    return this.db
      .update(schema.operations)
      .set({
        status: 'applied',
        trashPath: result.trashPath ?? null,
        trashSize,
        method: result.method ?? op.method,
        fingerprint,
      })
      .where(eq(schema.operations.id, id))
      .returning()
      .get()
  }

  /** The operation did not happen (it threw before changing anything). */
  abandon(id: number, error: string) {
    return this.db
      .update(schema.operations)
      .set({ status: 'abandoned', error })
      .where(eq(schema.operations.id, id))
      .returning()
      .get()
  }

  setStatus(
    id: number,
    status: schema.OperationStatus,
    extra: { error?: string | null; undoneAt?: number } = {},
  ) {
    return this.db
      .update(schema.operations)
      .set({ status, error: extra.error ?? null, undoneAt: extra.undoneAt ?? null })
      .where(eq(schema.operations.id, id))
      .returning()
      .get()
  }

  /** Keeps a note about what an import did to records the journal does not see. */
  annotate(id: number, note: unknown) {
    const op = this.get(id)
    if (!op) return
    this.db
      .update(schema.operations)
      .set({ snapshot: { ...op.snapshot, note } })
      .where(eq(schema.operations.id, id))
      .run()
  }

  get(id: number) {
    return this.db.select().from(schema.operations).where(eq(schema.operations.id, id)).get()
  }

  /** Operations that belong to another one (sidecars, replaced files), oldest first. */
  children(parentId: number) {
    return this.db
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.parentId, parentId))
      .orderBy(schema.operations.id)
      .all()
  }

  /** The operations users act on: everything that is not part of another operation. */
  batch(batchId: string) {
    return this.db
      .select()
      .from(schema.operations)
      .where(and(eq(schema.operations.batchId, batchId), isNull(schema.operations.parentId)))
      .orderBy(schema.operations.id)
      .all()
  }

  /** Every operation of a batch, children included. */
  batchAll(batchId: string) {
    return this.db
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.batchId, batchId))
      .orderBy(schema.operations.id)
      .all()
  }

  /** Top-level operations, newest first. */
  list(options: { status?: schema.OperationStatus; mediaId?: number; limit?: number } = {}) {
    const where = and(
      isNull(schema.operations.parentId),
      options.status ? eq(schema.operations.status, options.status) : undefined,
      options.mediaId ? eq(schema.operations.mediaId, options.mediaId) : undefined,
    )
    return this.db
      .select()
      .from(schema.operations)
      .where(where)
      .orderBy(desc(schema.operations.id))
      .limit(options.limit ?? 200)
      .all()
  }

  /** Applied operations newer than `id` that touch `dest` (or moved a file away from it). */
  newerTouching(id: number, dest: string, excludeBatch?: string) {
    return this.db
      .select()
      .from(schema.operations)
      .where(and(eq(schema.operations.status, 'applied')))
      .orderBy(schema.operations.id)
      .all()
      .filter(
        (op) =>
          op.id > id && op.batchId !== excludeBatch && (op.dest === dest || op.source === dest),
      )
  }

  /** Applied or failed-to-undo operations with a parked file, oldest first. */
  withTrash() {
    return this.db
      .select()
      .from(schema.operations)
      .where(inArray(schema.operations.status, ['applied', 'undo_failed']))
      .orderBy(schema.operations.id)
      .all()
      .filter((op) => op.trashPath)
  }

  olderThan(time: number) {
    return this.db
      .select()
      .from(schema.operations)
      .where(
        and(
          inArray(schema.operations.status, ['applied', 'undo_failed']),
          lt(schema.operations.createdAt, time),
        ),
      )
      .all()
  }

  /**
   * Settles operations a crash left `pending`: the file change either happened (keep the
   * record, flagged) or did not (abandon it). `olderThanMs` leaves recent ones alone, for a
   * caller that runs while imports are in flight.
   */
  async recover(olderThanMs = 0) {
    const pending = this.db
      .select()
      .from(schema.operations)
      .where(
        and(
          eq(schema.operations.status, 'pending'),
          lte(schema.operations.createdAt, Date.now() - olderThanMs),
        ),
      )
      .all()
    for (const op of pending) {
      const exists = await this.fs.stat(op.dest).then(
        () => true,
        (e) => {
          if (e.code === 'ENOENT') return false
          throw e
        },
      )
      // a delete happened when its file is gone; everything else when its file is there
      const happened = op.type === 'delete' ? !exists : exists
      if (!happened) {
        this.abandon(op.id, 'interrupted before the file changed')
        continue
      }
      const fingerprint = exists ? await fingerprintFile(op.dest).catch(() => null) : null
      this.db
        .update(schema.operations)
        .set({
          status: 'applied',
          fingerprint,
          error:
            op.type === 'place'
              ? 'recovered after an interruption'
              : 'interrupted; the replaced file may not be recoverable',
        })
        .where(eq(schema.operations.id, op.id))
        .run()
    }
    if (pending.length)
      this.ctx.logger.warn('settled %d interrupted file operations', pending.length)
    return pending.length
  }
}
