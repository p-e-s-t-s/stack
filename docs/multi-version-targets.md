# Multi-version targets (4K + 1080p of the same item)

Not a phase; a plan for keeping more than one version of a library item, each with its
own quality profile and optionally its own root folder. Radarr and Sonarr have declined
this for years ("one file per movie"); Magpie's schema already allows it.

**Scope:** movies first. Series follow (§7) because episode × target multiplies wanted
logic and season-pack handling; the schema below is designed so series need no further
migration.

## 1. What exists

- `library_media_files` (`plugins/library/src/schema.ts`) has `media_id` with **no
  uniqueness**, so an item can already hold several files.
- Everything above the schema assumes one: `movies/src/index.ts` sets
  `file: library.files(id)[0]`, `targetFor()` (`movies/src/search.ts`) builds the decision
  target's `current` from that one file, `wanted()`/`needed()` (`automation.ts`) asks
  "has a file?", and the movie importer replaces `files(item.id)[0]`.
- The profile and root folder live on the item: `library_media_items.profile_id` and
  `root_folder_id`, plus `folder` (the folder name inside the root).
- `downloads_grabs` has no notion of which version a grab is for; the `in-queue` rule
  (`downloads/src/index.ts`) keys on the media item.

## 2. Model

**Target** = a named goal for an item: a profile, an optional root folder, and a file-name
suffix.

- The item's existing `profile_id` / `root_folder_id` remain the **primary target**. It is
  not a row. This avoids a second source of truth and needs no data migration.
- New table owned by `library`, `library_targets`:

| Column | Meaning |
| ------ | ------- |
| `id` | |
| `media_id` | FK `library_media_items`, cascade |
| `name` | "4K", "Kids cut", "Mobile" (unique per item; used in file names) |
| `profile_id` | FK `decision` profiles, restrict |
| `root_folder_id` | FK `library_root_folders`, nullable (null = the item's root) |
| `monitored` | can be paused independently |

- `library_media_files` gains `target_id` (FK `library_targets`, `restrict`).
  `null` means the primary target.
- Deleting a target: its files are not deleted silently. The UI asks ("keep files / move
  to trash"), and the FK is `restrict` while files reference it.
- `grabs` gains a nullable `target_id` (owned by `downloads`, FK to `library_targets`),
  so import knows where the download goes.

A per-kind default ("every movie also gets a 4K target") is a later convenience:
**default targets** per root folder or tag that are applied when an item is added.

## 3. Behaviour

### 3.1 Wanted and search

- `needed(movie)` becomes `neededTargets(movie)`: the monitored targets that have no file
  or whose file hasn't met the cutoff. `wanted` = item monitored and any such target.
- `targetFor(movie, target)` builds the decision target from that target's profile and
  that target's current file. `DecisionTarget` gains `targetId`.
- Interactive search gets a target selector; automatic search, the RSS matcher and the
  daily sweep run **per target**. RSS evaluates a release against every wanted target of
  the matched movie, then grabs the best release per target.
- The `in-queue` rule keys on `(mediaId, targetId)`, so a 4K grab in progress doesn't
  suppress the 1080p one.
- The blocklist stays **per item**: a bad release is bad for every target.

### 3.2 One release, two targets

Two profiles will often accept the same release. Policy: each target is satisfied
independently, but a grab may satisfy several targets at once. When a grab finishes and
its release also passes another wanted target's decision, import places the file for both
(hardlinked, so no extra space). This must be conservative:

- Only when the second target's decision accepts it, with the same rules as a normal grab.
- Never displaces a better file in that target.
- The UI warns when two targets' profiles overlap so heavily that they'd always share
  files.

### 3.3 Import and naming

- The importer takes the grab's `targetId`, replaces only **that target's** file, and
  records the new file with `target_id`.
- Non-primary targets get a file-name suffix so media servers treat the files as versions:
  `Movie (2020)/Movie (2020) - 4K.mkv` (the suffix convention Plex, Jellyfin and Emby read).
  Add a `{Target}` token to the naming template (`library/src/index.ts` `renderName`), with
  the default template appending ` - {Target}` only for non-primary targets.
- A target with its own root folder lands in `<that root>/<item.folder>/`;
  `library.folderOf(item, targetId)` resolves it, so `library_media_files.path` stays
  relative to the right folder.
- Hardlinks: downloads and both versions may live on different filesystems; the existing
  hardlink→copy fallback applies per file.

### 3.4 Other plugins

- **Subtitles** attach to files (`file_id`), so each version gets its own subtitle scan
  and requirements with no change; the subtitle profile stays per item.
- **History** events carry `targetId` in `data`, shown as a chip.
- **Undo** ([plan](undo-file-operations.md)): operations are per file, and "newer
  operation on the same item" checks become per target.
- **Post-download checks** ([plan](post-download-checks.md)): unchanged; the target's
  profile supplies the expected language and quality.
- **Calendar, status badges:** an item is "downloaded" when all monitored targets have
  files; show per-target chips otherwise.
- **`compat-api` (Radarr v3):** exposes the primary target's file only as `movieFile`;
  extra targets are invisible to Prowlarr and Overseerr, which is correct for them.

### 3.5 Rescan and manual import

`review.ts` rescans folders and currently treats the item's single file as the match.
With several files in a folder it must assign each to a target: by the ` - <Target>`
suffix when present, otherwise by the target whose profile ranks it best (primary wins
ties), and flag ambiguous ones in the preview instead of guessing. Until that's done a
folder with two versions must not be rescanned destructively; step 1 of the work below adds
a guard.

## 4. UI

- Movie detail: a versions panel. Each row is a target with its profile, root folder, file
  and quality, status (missing / upgrade wanted / met), and search / interactive search /
  delete-target actions. "Add version" picks a profile and optional root folder.
- Movie list: an optional second badge for additional targets; a filter for "missing a
  version".
- Settings: a default-targets rule editor (phase 2).

## 5. Work breakdown

| # | Step | Files | Size |
| - | ---- | ----- | ---- |
| 1 | Guard: rescan refuses folders with several files per item | `import/src/review.ts` | S |
| 2 | `library_targets`, `media_files.target_id`, `grabs.target_id` migrations; service API (`files(mediaId, targetId)`, `folderOf(item, targetId)`, target CRUD) | `library`, `downloads` | M |
| 3 | `DecisionTarget.targetId`; `in-queue` rule keyed per target | `decision`, `downloads` | S |
| 4 | Movies: `neededTargets`, per-target search, RSS, sweep; `Movie.files` replaces `Movie.file` | `movies` | L |
| 5 | Importer and naming (`{Target}`, per-target replace) | `movies/src/import.ts`, `library` naming | M |
| 6 | Rescan/manual-import target assignment | `import/src/review.ts`, `movies/src/import.ts` | M |
| 7 | UI: versions panel, target-aware interactive search | `movies/client`, `console-kit` | M |
| 8 | Shared-release import (§3.2), default targets | `import`, `movies`, `library` | M |

Steps 1–5 and 7 deliver a working feature. 6 is required before recommending it to anyone
with an existing library.

## 6. Tests

- Migration: existing items and files behave identically (primary target, `target_id` null).
- Wanted: each target independently missing / cutoff-unmet / met; unmonitored target
  ignored; removing a target with files is refused.
- Search/RSS/sweep: one movie, two targets, two different releases grabbed, each imported
  into its own file with the right suffix and root folder; the `in-queue` rule allows both.
- A failed 4K download blocklists the release for both targets and re-searches only the
  4K target.
- Shared release (step 8): one grab satisfies two targets with a hardlink; never
  overwrites a better file.
- Rescan: suffix assignment, profile-based assignment, ambiguous flagged, guard before
  step 6.
- Subtitles: each version scanned and requirements tracked separately.
- `compat-api` returns only the primary file.

## 7. Series (phase 2)

The same `target_id` on files applies. What's new: wanted is episode × target; a season
pack may satisfy some targets and not others; `episode_files` links a file to episodes,
so the importer must pick the target's file when replacing; file-name suffix goes on the
episode name. Do this only after movies have shipped and the UI has settled; pack handling
is the hard part.

## 8. Open questions

- **Primary as virtual vs a real row.** Virtual is proposed (no migration, one source of
  truth), at the cost of `null` meaning "primary" in a few queries. A real row would
  simplify code but needs a backfill and keeping `media_items.profile_id` in sync.
- **Sharing policy:** automatic double-placement (3.2) or require explicit opt-in per
  target? Recommend opt-in to start.
- **Cutoff interplay:** should a 4K target being met stop the 1080p target from searching
  (a common wish, "only want 1080p if there's no 4K")? That is a dependency between
  targets ("fallback of") and is deferred.
- **Disk space:** show the projected extra space when adding a version, using the
  quality-size definitions and runtime.
- **Media server support for the naming convention** should be verified against current
  Plex, Jellyfin and Emby docs before step 5 ships.
