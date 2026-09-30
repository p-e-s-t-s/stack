# Undoable file operations

> **Status:** steps 1–5 and most of 6–7 are built. Where this plan disagrees with
> "What was built" at the end, the latter wins.

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
| `parentId`              | set on sidecar operations; points at the video operation they belong to   |
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

### 2.6 Sidecar files

Sidecars (subtitles next to the video) follow the movie. They are journaled as **child
operations** (`parentId` = the video's operation), so the UI, batch counts and "Undo"
button stay per item, while undo still restores every file.

- **Discovery.** At operation time, list the destination and source folders and match
  names with `sidecar(video, name)` from `subtitles/src/files.ts`, so both plugins agree
  on what counts as a sidecar (one language suffix, known extensions). Move this helper
  to a shared package, or expose it through the subtitles plugin, rather than copying it.
  Dot-prefixed `.magpie-*` staging and backup files are never sidecars (the extension
  check already excludes them).
- **Per type.**
  - `rename` / `place` by move: sidecars are renamed or moved with the video; undo reverses
    each.
  - `replace`: old sidecars are parked in the trash with the old video (the new release
    may not sync with them); undo restores both. Subtitles fetches fresh ones on
    `library/file-added`, as it does today.
  - `place` by hardlink/copy (new import): nothing pre-exists, nothing to carry.
  - `delete`: sidecars are trashed with the video and restored with it.
- **Fingerprint the video only.** Users edit and re-sync subtitles, and that must not block
  undoing the video. On undo, a sidecar whose hash no longer matches its journal entry is
  skipped and reported, never overwritten or deleted silently.
- **No subtitle DB snapshot.** The subtitles plugin reconciles from disk on
  `library/file-added` / `file-removed`, so undo only moves files and the hooks re-emit
  the events. Subtitles keeps its own `operations` journal for installs it makes; that is
  separate and is not undone by this feature.
- A failed sidecar step marks that child `undo_failed` and the parent
  `undone` with warnings; it does not roll back the video.

## 3. UI

- **History page:** an "Undo" button on `imported` events while their operation is
  `applied`, with a tooltip explaining why it's unavailable (expired, changed on disk,
  newer operation).
- **Operations list** (System): batches with counts, status and "Undo batch".
- **Import/rescan result screen:** a banner "N files changed — Undo all".
- Shared confirmation panel listing exactly which files move where.

## 4. Work breakdown

| #   | Step                                                                   | Files                                     | Size |
| --- | ---------------------------------------------------------------------- | ----------------------------------------- | ---- |
| 1   | `import_operations` table + journal service                            | `import/src`, migration                   | M    |
| 2   | Managed trash, retention job, settings                                 | `import/src/files.ts`, `library` settings | M    |
| 3   | Journal writes (incl. sidecars) in `placeSafely`, `recycle`, importers | `import`, `movies`, `series`              | M    |
| 4   | Undo engine with fingerprint, stack and containment checks             | `import/src`                              | M    |
| 5   | Kind undo hooks (movies, series) restoring DB rows                     | `movies`, `series`                        | M    |
| 6   | Review `commit()` batching and bulk rename with preview                | `import/src/review.ts`                    | M    |
| 7   | History, operations UI                                                 | `history`, `import/client`                | M    |

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
- Sidecars: rename/replace/delete carry them as child operations and undo restores them;
  a user-edited sidecar is skipped with a warning while the video still undoes; `.magpie-*`
  backup files are never treated as sidecars.
- Retention job purges by age and by size cap and marks operations `expired`.

## 6. Open questions

- **Default retention and trash on by default?** Recommend on, 7 days, 20 GB cap, with a
  clear first-run notice.
- ~~**Sidecar files**~~ Resolved: they follow the video as child operations, see §2.6.
  Still open: where the shared `sidecar()` matcher lives (shared package vs. exported by
  subtitles), to settle in step 3.
- **Undo of deletions the user made elsewhere** (file manager, Plex): out of scope; only
  operations Magpie performed.
- **Should undo also exist for metadata changes** (title match, monitor flags)? Different
  mechanism; out of scope here.

## 7. What was built

Single-import undo (steps 1–5), batches for download imports and manual-import commits, and
the UI (step 7). Differences from the plan above:

- **Shared sidecar matcher:** `@magpiejs/sidecars` (`packages/sidecars`) holds `sidecar()`,
  `findSidecars()` and `sidecarTarget()`; subtitles and import both use it.
- **Journal** (`import_operations`, migration `0001_operations`): two extra statuses,
  `pending` (journaled, the file change is not confirmed) and `abandoned` (it never
  happened). `Journal.recover()` settles `pending` rows at start-up and, for ones older than an
  hour, from the hourly job. The operation's own `parentId` marks replaced files and sidecars.
  The migration was added by hand in the plugin's existing layout (renaming `0000_sessions`
  would make the runner see drift), so it has no drizzle-kit snapshot; the next
  `db:generate` needs the plugin converted with `drizzle-kit up` and its migration tags kept.
- **Settings** (Media management): `undoRetentionDays` (default 7; **0 turns undo off**, and
  then nothing is journaled and replaced files are deleted as before) and `undoMaxGb`
  (default 20, 0 for no cap). With no recycle bin set, replaced files go to `<config>/trash`;
  a recycle bin the user set is used as before, and is never emptied by Magpie (operations
  that used it still expire, the files stay). The hourly `import.purge` job expires by age and
  size, and removes trash files nothing refers to once they have been untouched for a day.
  The trash is not on the library's filesystem in most installs, so a replacement there is a
  copy, not a rename.
- **Recorder:** `ctx.import.recorder(item, { batchId, targetId })` journals a file placement
  (`place`/`replace`), and replaced files and their sidecars (`delete`, as parts of it).
  Importers did not change: `tools.place()` and `tools.recycle()` record, and capture the
  library file record that is replaced or removed. `tools.annotate(note)` lets an importer
  keep something the journal cannot see; series uses it for episode links a kept
  multi-episode file lost.
- **Sidecars** are trashed with a replaced video only when the old video's path goes away.
  A same-name replacement leaves them where they are, since they still belong to the new
  file. On undo, a sidecar whose name has been taken again (a provider wrote a new
  subtitle there) is left alone with a warning and the video still comes back; a replaced
  _video_ that is missing from the trash blocks the undo.
- **Kind hooks:** `ctx.import.registerUndo(kind, { capture, restore, rollback, changed })`.
  Series registers them (episode links). Movies needs none: file records carry everything.
  Hooks run after the library transaction, since kinds open their own.
- **Undo checks:** the fingerprint is size, mtime and a hash of the first and last 64 KiB. A
  newer applied operation elsewhere on the same path blocks an undo; a batch undoes its
  own operations newest-first and carries on past the ones that fail. A usenet import
  (move) goes back only while its download folder exists.
- **UI:** the History page has an Undo button on imported events (with a list of what
  moves), the Import page lists recent imports with Undo and offers "Undo all" after a
  commit. `import-undone` history events record it. The grab stays `imported`; "Undo and
  blocklist" / "Undo and search again" (§2.5) are not built.

Not built: **bulk rename with preview** (step 6, second half), and with it any producer of
`rename` operations (the engine can already undo them); undo for music, books and podcasts;
"Undo and blocklist" / "Undo and search again". Not journaled: the "remove missing records"
option of a rescan (it only deletes records, never files) and deletes made elsewhere in
Magpie (removing a movie version, podcast retention).
