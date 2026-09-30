# Undoable file operations

Not a phase; a plan for a journal that records every file change Magpie makes to a library
and lets you roll back a single import, a replacement, or a whole batch ("the rescan
renamed 400 files wrong").

## 1. What exists

All library file changes happen in a few places in `plugins/import`:

- `placeSafely()` / `transfer()` (`files.ts`): hardlink, copy or move a download into the
  library. An existing destination is staged, swapped, and the old file goes to
  `recycle()`.
- `ReviewService.commit()` (`review.ts`): the manual-import and rescan flow. It already has
  a preview step, per-row status, resumable commits and backup-on-swap.
- Kind importers (`movies/src/import.ts`, `series/src/import.ts`): replace an existing
  file, `recycle()` the old one, `library.removeFile()` / `addFile()`.

Nothing records _what_ was done, so nothing can be reversed. `history` logs
`imported` events, but only as display data (`data.path`, `data.replaced`).

Two facts constrain the design:

1. **The recycle bin is off by default** (`DEFAULT_FILE_HANDLING.recycleBin = ''`), and
   `recycle()` then deletes the file. A replaced file is gone, so undo of a replace is
   impossible today.
2. Library file changes also update DB rows (`library_media_files`, series
   `episode_files`) and emit `library/file-added` / `file-removed`, which the subtitles
   plugin listens to. Undo has to reverse those too.

## 2. Design

### 2.1 Journal

A new table owned by `import` (it performs the operations), `import_operations`:

| Column                  | Meaning                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `id`, `batchId`         | one batch per import job, review commit or bulk action                    |
| `mediaId`               | item affected (FK `library_media_items`, cascade)                         |
| `type`                  | `place`, `replace`, `rename`, `delete`                                    |
| `source`, `dest`        | absolute paths; `source` null for deletes                                 |
| `method`                | `hardlink`, `copy`, `move`                                                |
| `trashPath`             | where a replaced or deleted file was parked                               |
| `fingerprint`           | size + mtime (+ short hash) of `dest` right after the operation           |
| `snapshot`              | JSON: the DB rows the operation removed or changed, opaque to the journal |
| `status`                | `applied`, `undone`, `undo_failed`, `expired`                             |
| `createdAt`, `undoneAt` |                                                                           |

Written in the **same code path** as the operation, before the DB update: journal row
first (`applied`), then the filesystem change, so a crash leaves a row the undo can
reason about rather than an unexplained file.

### 2.2 Undo semantics per operation

| Operation                | Undo                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `place` by hardlink/copy | unlink `dest`; source is untouched, so the download and its seeding are unaffected                   |
| `place` by move (usenet) | rename `dest` back to `source` if the download folder still exists; otherwise refuse with the reason |
| `replace`                | unlink the new file, move `trashPath` back to `dest`                                                 |
| `rename`                 | rename back                                                                                          |
| `delete`                 | move `trashPath` back                                                                                |

Then the kind plugin restores its DB rows from `snapshot` through a hook, like importers
(`ctx.import.registerUndo(kind, fn)`), so `import` stays kind-agnostic. The hook calls
`library.addFile` / `removeFile`, which re-emits the library events subtitles already
handles.

Safety checks before any undo:

- **Fingerprint match.** If `dest` changed since the operation (user replaced it, another
  tool rewrote it) refuse, and offer "undo anyway" only for renames.
- **Stack order.** If a newer applied operation touches the same item (and target, see
  [multi-version](multi-version-targets.md)), undo that first, or undo both as one chain
  with a confirmation listing each step.
- **Path still contained** in the item's folder, reusing the `contained()` check from
  `review.ts`.
- Undo itself is journaled (`undone`), and a failed step leaves `undo_failed` with the
  error, never a half-state without a record.

### 2.3 Parking replaced files ("trash")

Undo of `replace`/`delete` needs the old file. Change `recycle()` so that with no
recycle bin configured, files go to a Magpie-managed `trash/` directory under the config
dir (on the same filesystem where possible, so the move is a rename, not a copy), and a
job purges entries after `undoRetentionDays` (default 7). The user's own recycle bin
setting keeps working and is used when set; the journal stores whichever path was used.

This changes a default (today a replaced file is deleted immediately), so it needs a
setting, a disk-space note in the UI, and a cap (`undoMaxGb`, oldest purged first;
purged operations become `expired`).

### 2.4 Batches and dry run

- Every `commit()` of a review session is one batch. The existing preview step is the dry
  run. Add the same preview-then-commit flow to new bulk actions (mass rename after a
  naming-template change) so every bulk change is previewable and batch-undoable.
- Undoing a batch processes operations newest-first and continues past individual
  failures, reporting each.

### 2.5 Grab and history state

- After undoing an import from a download, the grab stays `imported`; add a history event
  `import-undone`. Offer "Undo and blocklist release" (calls the existing
  `downloads.remove(..., { blocklist: true })` path) and "Undo and search again".
- The item is wanted again automatically because the file row is gone.

## 3. UI

- **History page:** an "Undo" button on `imported` events while their operation is
  `applied`, with a tooltip explaining why it's unavailable (expired, changed on disk,
  newer operation).
- **Operations list** (System): batches with counts, status and "Undo batch".
- **Import/rescan result screen:** a banner "N files changed — Undo all".
- Shared confirmation panel listing exactly which files move where.

## 4. Work breakdown

| #   | Step                                                       | Files                                     | Size |
| --- | ---------------------------------------------------------- | ----------------------------------------- | ---- |
| 1   | `import_operations` table + journal service                | `import/src`, migration                   | M    |
| 2   | Managed trash, retention job, settings                     | `import/src/files.ts`, `library` settings | M    |
| 3   | Journal writes in `placeSafely`, `recycle`, importers      | `import`, `movies`, `series`              | M    |
| 4   | Undo engine with fingerprint, stack and containment checks | `import/src`                              | M    |
| 5   | Kind undo hooks (movies, series) restoring DB rows         | `movies`, `series`                        | M    |
| 6   | Review `commit()` batching and bulk rename with preview    | `import/src/review.ts`                    | M    |
| 7   | History, operations UI                                     | `history`, `import/client`                | M    |

Steps 1–5 give single-import undo; 6–7 add batches and UI. Music, books and podcasts
adopt the hooks afterwards (they register importers the same way).

## 5. Tests

- Journal/undo round-trip per operation type against a temp directory, using the
  injectable `fileSystem` to simulate cross-device links and mid-operation failures.
- Crash safety: kill between journal write and filesystem change, and between filesystem
  change and DB update; both leave a consistent state after restart.
- Undo refused when the file changed, when a newer operation exists, and when the trash
  entry was purged.
- Undo restores `library_media_files` and emits `library/file-added` (subtitles rescan
  observed).
- Series: undo of a season-pack import with a multi-episode file still needed elsewhere
  (see the guard at `series/src/import.ts:136`).
- Retention job purges by age and by size cap and marks operations `expired`.

## 6. Open questions

- **Default retention and trash on by default?** Recommend on, 7 days, 20 GB cap, with a
  clear first-run notice.
- **Sidecar files** (subtitles next to the video): moves and renames need to carry them
  and journal them, so undo restores them too. Confirm how the subtitles plugin expects
  them to move before step 3.
- **Undo of deletions the user made elsewhere** (file manager, Plex): out of scope; only
  operations Magpie performed.
- **Should undo also exist for metadata changes** (title match, monitor flags)? Different
  mechanism; out of scope here.
