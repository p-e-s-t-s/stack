# Multi-version targets (4K + 1080p of the same item)

Not a phase; a plan for keeping more than one version of a library item, each with its
own quality profile, all in the item's one folder. Radarr and Sonarr have declined
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

**Target** = a named goal for an item: a profile and a file-name suffix. Every target's
file lives in the item's own folder (`<root>/<item.folder>/`): media servers only group
versions found in one folder (§3.5), so targets cannot have their own root folder.

- The item's existing `profile_id` remains the **primary target**. It is
  not a row. This avoids a second source of truth and needs no data migration.
- New table owned by `library`, `library_targets`:

| Column           | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `id`             |                                                                  |
| `media_id`       | FK `library_media_items`, cascade                                |
| `name`           | "4K", "Kids cut", "Mobile" (unique per item; used in file names) |
| `profile_id`     | FK `decision` profiles, restrict                                 |
| `monitored`      | can be paused independently                                      |

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
  `Movie (2020)/Movie (2020) - 4K.mkv` (the suffix convention Plex, Jellyfin and Emby read;
  verified in §3.5).
  Add a `{Target}` token to the naming template (`library/src/index.ts` `renderName`), with
  the default template appending ` - {Target}` only for non-primary targets.
- All targets land in the item's folder, so `library_media_files.path` stays relative to
  `library.folderOf(item)` and no per-target folder resolution is needed.
- Hardlinks: the download may live on a different filesystem from the library; the
  existing hardlink→copy fallback applies per file.

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

### 3.5 Media servers

The file layout is the only integration: Magpie writes versions in the shape the servers
group, and the media-server refresh ([plan](notifications-media-refresh.md)) reports the
item's folder after import, which covers every version. Checked against the servers' docs
(2026-09-30):

- **Jellyfin:** each version file name must begin exactly with the folder name (including
  year and any provider ID such as `[imdbid-tt…]`), then a separator (` - `, `.`, `_` or
  brackets; spaces optional), then a label. A mismatch makes them separate items. Sorted
  alphabetically except resolutions, which sort descending.
  [Jellyfin docs](https://jellyfin.org/docs/general/server/media/movies/)
- **Emby:** all versions in one movie folder, each beginning with the folder name followed
  by ` - `; the text after the dash is shown in the client. At most 8 versions are listed.
  [Emby docs](https://emby.media/support/articles/Movie-Naming.html)
- **Plex:** `MovieName (Release Year) - ArbitraryText.ext` in the movie's folder, e.g.
  `Pulp Fiction (1994)/Pulp Fiction (1994) - 1080p.mkv`. The text after the dash is for
  humans outside Plex and is **not displayed**; Plex shows the real resolution. Apps pick
  the best version by default, and not every app offers a version picker. Editions are a
  separate feature, not used here.
  [Plex docs](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/)
  (page text supplied by the user; the site blocked our fetch).

Consequences for naming:

- The default template must render `<folder name> - {Target}`: the prefix has to equal the
  folder name character for character, or Jellyfin splits the movie. If users customize
  the file-name template away from the folder name, warn when targets exist.
- ` - ` is the one separator all three accept. Target names must not contain path
  separators or characters the naming code strips.
- The primary file (no suffix) is the folder name alone, which all three accept as one
  of the versions.
- Emby shows the target name; Jellyfin shows the label; Plex ignores it and shows the real
  resolution. Plex may not offer a version picker in every app, so the UI shouldn't
  promise one.
- Import must place the file before (or together with) the refresh; the refresh intent
  names the item folder, not individual files.

### 3.6 Rescan and manual import

`review.ts` rescans folders and currently treats the item's single file as the match.
With several files in a folder it must assign each to a target: by the ` - <Target>`
suffix when present, otherwise by the target whose profile ranks it best (primary wins
ties), and flag ambiguous ones in the preview instead of guessing. Until that's done a
folder with two versions must not be rescanned destructively; step 1 of the work below adds
a guard.

## 4. UI

- **Single-target items render exactly as today**: no versions panel, badge, chip,
  selector or filter appears until an item has a second target. The only entry point is an
  "Add version" action on the movie detail page.
- Movie detail: a versions panel, shown only once a second target exists. Each row is a target with its profile, file
  and quality, status (missing / upgrade wanted / met), and search / interactive search /
  delete-target actions. "Add version" picks a profile.
- Movie list: an optional second badge for additional targets; a filter for "missing a
  version".
- Settings: a default-targets rule editor (phase 2).

## 5. Work breakdown

| #   | Step                                                                                                                                                        | Files                                          | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---- |
| 1   | Guard: rescan refuses folders with several files per item                                                                                                   | `import/src/review.ts`                         | S    |
| 2   | `library_targets`, `media_files.target_id`, `grabs.target_id` migrations; service API (`files(mediaId, targetId)`, `folderOf(item, targetId)`, target CRUD) | `library`, `downloads`                         | M    |
| 3   | `DecisionTarget.targetId`; `in-queue` rule keyed per target                                                                                                 | `decision`, `downloads`                        | S    |
| 4   | Movies: `neededTargets`, per-target search, RSS, sweep; `Movie.files` replaces `Movie.file`                                                                 | `movies`                                       | L    |
| 5   | Importer and naming (`{Target}`, per-target replace)                                                                                                        | `movies/src/import.ts`, `library` naming       | M    |
| 6   | Rescan/manual-import target assignment                                                                                                                      | `import/src/review.ts`, `movies/src/import.ts` | M    |
| 7   | UI: versions panel, target-aware interactive search                                                                                                         | `movies/client`, `console-kit`                 | M    |
| 8   | Shared-release import (§3.2), default targets                                                                                                               | `import`, `movies`, `library`                  | M    |

Steps 1–5 and 7 deliver a working feature. 6 is required before recommending it to anyone
with an existing library.

## 6. Tests

- Migration: existing items and files behave identically (primary target, `target_id` null).
- Wanted: each target independently missing / cutoff-unmet / met; unmonitored target
  ignored; removing a target with files is refused.
- Search/RSS/sweep: one movie, two targets, two different releases grabbed, each imported
  into its own file with the right suffix in the item's folder; the `in-queue` rule allows both.
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
- **Plex name prefix:** Plex wants `Name (Year)` before the dash. Confirm the default
  folder template always yields that (Jellyfin additionally wants the folder name, including
  any provider ID, as the prefix).
- **Existing-library folders** whose files don't start with the folder name (renamed or
  imported by hand) won't group in Jellyfin; decide whether the rescan flow offers to
  rename them.
