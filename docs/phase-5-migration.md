# Phase 5 — Radarr / Sonarr migration

Implementation plan for the migration part of [PLAN.md](PLAN.md#phase-5--migration--library-scan).
This is a deliberately small first version: a guided wizard that brings an existing movie and
TV library into Magpie in place, with cancel and resume. Source API compatibility must be
verified against real instances during adapter work.

## 1. Goal and scope

Bring an existing library into Magpie without moving, renaming or deleting any file, keeping
monitoring and file records. Migration is a one-time transfer, not continuous sync.

**v1 includes**

- Radarr: movies, files, monitoring, dates added.
- Sonarr: series, seasons, episodes, monitoring, files, multi-episode links, TVDB → TMDB
  identity resolution.
- Root-path mapping with auto-detection, quality profile mapping by selection.
- Preview (dry run), import, cancel, resume, summary report.

**Not in v1:** SQLite transport, history, tags, download-client/indexer import, custom-format
translation, Bazarr data, active download ownership, removal of the old apps. These can follow
once the core flow is proven.

## 2. Plugin layout

| Plugin                   | Owns                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `plugins/migrate-arr`    | `migratearr_*` tables, normalized record types, mapping, preview, import job, report, API, Settings → wizard  |
| `plugins/migrate-radarr` | Radarr source adapter (API): fetch and normalize movies, files, profiles, roots                               |
| `plugins/migrate-sonarr` | Sonarr source adapter (API): fetch and normalize series, episodes, files, profiles, roots, TVDB identity data |

The core exposes `ctx.migrateArr.registerSource({ kind, test, capture })`; the adapter types
live in `packages/types`. Either adapter can be enabled alone. Shared HTTP behavior (paging,
timeouts, retry) comes from `packages/http-utils`. SQLite adapters, later, plug into the same
contract.

## 3. Wizard flow

One guided wizard under Settings → Migration, one decision per screen, Back available
everywhere, progress shown at the top. Every screen has a smart default; overriding is optional.

1. **Before you start.** Short checklist: finish or pause active downloads, pause automation
   in Radarr/Sonarr (search and RSS), make sure Magpie can see the same media folders (mounts
   in Docker). States up front: files are not moved, changed or deleted; a backup is taken
   before importing.
2. **Connect.** Pick Radarr or Sonarr, enter URL and API key, test. Show the detected version
   and counts ("1,210 movies"). Credentials stay server-side.
3. **Scan.** Fetch the library with progress and cancel. Re-scanning is allowed any time
   before import.
4. **Folders.** For each source root, auto-detect the Magpie path:
   - Check whether the source path exists as-is; if not, suggest a likely prefix mapping.
   - Verify by sampling files and report "found 1,204 of 1,210 files".
   - Let the user edit the mapping; re-check on change. Block continuing only when no files
     are reachable for a root; missing individual files are reported, not blocking.
5. **Quality profiles.** Pre-select the closest existing Magpie profile per source profile
   (name, then quality list), flagged "looks right" or "check this". A source profile can also
   be mapped to a user-chosen Magpie profile. No custom-format translation in v1.
6. **Preview.** Dry run through the same code as import. Plain summary: "1,210 movies and 86
   series will be added. 12 already exist and will be left alone. 6 have missing files. Your
   files won't be touched. Nothing will be searched or downloaded." Expandable lists for
   skipped and problem items, each with a reason. Preview writes only migration staging data.
7. **Import.** Backup, then background job with progress, current item and Cancel. Cancel stops
   after the current item.
8. **Results.** Counts of imported, skipped (already exists) and failed with reasons, a Retry
   button for failures, and report export (JSON plus readable summary). Closing guidance:
   disable automation in the old apps, then try one search in Magpie. Backup restore
   instructions are shown here.

## 4. Implementation notes

**Pipeline:** `source adapter → normalized records → mappings → preview/import → report`.
Adapters produce source-independent records (roots, profiles, media, episodes, files), each
tagged with source kind, source instance and source ID so Radarr and Sonarr IDs never collide.

**Tables** (all prefixed `migratearr_`):

- `sources`: connection metadata. The API key is held only as long as the wizard needs it,
  using the existing credential mechanism if one exists, otherwise in memory with re-entry
  after restart. Never in job payloads or reports.
- `runs`: status (`running`, `done`, `failed`, `cancelled`), counts, backup reference.
- `records`: scanned records with proposed action and reason.
- `mappings`: root and profile decisions.
- `entities`: ledger of source ID → destination ID. This is what makes resume and re-runs
  safe: anything already in the ledger is skipped.

**Import behavior**

- Each item is written in one transaction together with its ledger row, so a crash leaves
  both or neither. Network lookups and filesystem checks happen before the transaction.
- Existing Magpie records are reused and never overwritten. Matching uses stable IDs (TMDB,
  TVDB) and validated paths, never names alone.
- Items with unreachable files are imported without a file record and reported as missing;
  they are never marked downloaded.
- Resume continues from the ledger. Retry re-attempts only failed items.
- Reject path traversal and symlink escapes; refuse two files competing for one episode
  (the destination allows one file per episode) and report it.
- Unknown file quality is reported, not relabeled as a known quality.
- Source URLs: allow LAN/private addresses, restrict to http/https, validate redirects, do
  not forward credentials on redirect.

**Endpoints** under `/api/v1/migrations`: test source, scan, mappings, preview, import,
cancel, resume, retry, report. The console uses the same service methods. They require a
signed-in user or API key, like every other endpoint.

## 5. Changes to existing plugins

What the current code does, and what has to change. Checked against the repo, not assumed.

| Plugin                 | Today                                                                                                                                                    | Change needed                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `movies`               | `add()` looks up metadata, renders a folder name and emits `movies/added` (starts a search by default).                                                  | New ingestion method: takes metadata, exact folder, added date and monitoring; no lookup, naming or search event.                                                     |
| `series`               | Same shape as movies. `series_details.tmdb_id` is required and unique; `tvdb_id` is optional.                                                            | Ingestion for seasons and episodes with exact monitoring, no `series/added` search. TVDB-only series need TMDB resolution (see below); keep refresh from overwriting. |
| `metadata-tmdb`        | `mapIds` only turns an IMDb ID into a TMDB _movie_ ID. No TVDB lookup.                                                                                   | Extend `mapIds` to call TMDB `/find` with `tvdb_id` and return the TV result. Sonarr always has a TVDB ID, so this is required for Sonarr.                            |
| `library`              | Items store `rootFolderId` + `folder`; several root folders per kind are supported. `addRootFolder` runs `mkdirSync`; `add()` emits `library/added`.     | Register an existing root without creating directories; file upsert at existing paths; multi-episode files as one record with several links; no add event.            |
| `decision`             | Owns profiles.                                                                                                                                           | Read-only access to list profiles for mapping. No creation in v1.                                                                                                     |
| `jobs`                 | Persisted queue and schedules.                                                                                                                           | Import job with per-item checkpoints and cancel; resume reads the ledger.                                                                                             |
| `database` / `backup`  | Backups and staged restore exist.                                                                                                                        | Reuse for the pre-import backup; expose a synchronous transaction so item, file records and ledger row commit together.                                               |
| `api`, `auth`, `webui` | `auth` has users, sessions and API keys but no roles. `api` endpoints are auth-checked. Settings fields support a `secret` type, stored in `magpie.yml`. | Add `/api/v1/migrations` endpoints and a Settings → Migration entry. No role work (see section 8).                                                                    |

**Sonarr identity.** Resolve each series TVDB → TMDB through `mapIds`. No result, or more
than one, skips that series with a reason; never guess from the title. Keep the TVDB ID on
the record. Season and episode numbers are copied from Sonarr as-is.

Do not call `movies.add()` or `series.add()` and patch the result: they fetch metadata,
generate folder names and emit events that start automation. Each destination write stays in
its owning service; the migration plugin orchestrates and owns only `migratearr_*` tables.

**Automation gate:** while an import runs, and until the user finishes the wizard, search and
RSS automation must not act on items being migrated, including across a restart. Newly
imported items start with automation held and are released at the end of the wizard.

## 6. Delivery sequence

1. **Contracts and fixtures.** Pick supported Radarr and Sonarr versions, capture sanitized
   API payloads, define normalized record types. Clean-room: Radarr and Sonarr are GPL-3.0,
   so work from public docs and observed behavior only; do not copy code or tests.
2. **Destination prerequisites.** Ingestion in `movies`, `series` and `library`, TVDB → TMDB
   resolution, exact monitoring, automation gate. This is the riskiest step.
3. **Core plus Radarr adapter.** Schema, mappings, folder auto-detection, preview, report,
   wizard screens. Milestone: Radarr preview works end to end against a fixture.
4. **Radarr import.** Backup, ledger, per-item transactions, cancel, resume, results screen.
5. **Sonarr adapter.** Series, specials, daily and anime, multi-episode files, identity
   resolution; reuse the existing core.
6. **Real-library testing,** then ship. Later: SQLite transport, history, tags, configuration
   import, custom-format translation.

## 7. Acceptance criteria

- Fixtures cover: movie files, missing files, specials, daily/anime series, mixed episode
  monitoring, multi-episode files, multiple roots, Windows and Unix path mappings, an
  existing destination record, and an unreachable root.
- Preview creates no library records, directories or files and schedules no searches.
- Import keeps exact mapped paths and monitoring and never moves, renames or deletes files.
- A cancelled, interrupted or repeated import creates no duplicate media or files.
- A crash during an item leaves the owner records and ledger both committed or neither.
- Search and RSS cannot act on items mid-migration.
- Every source item appears in the report as imported, skipped or failed, with a reason.
  Credentials never appear in staged data, reports, logs or job payloads.
- A first-time user with a Docker Radarr and Sonarr library can finish the wizard accepting
  the defaults, with folder mapping auto-detected in the common case.
- A real Radarr and Sonarr library imports with no unexplained mismatches, followed by a
  successful search, download and import in Magpie.

## 8. Decisions and open questions

Decided:

- **Auth:** `plugins/auth` has no roles, only users and API keys, so migration is open to
  any authenticated caller. Revisit if roles are added.
- **Credentials:** the source API key is held in memory only; after a restart the wizard
  asks for it again. Nothing is written to `magpie.yml`, the database or job payloads.
- **TVDB:** needs a small addition to `metadata-tmdb` (section 5).

Still open:

- Which Radarr and Sonarr major versions to support first (assumed Radarr v5, Sonarr v4).
- Whether an imported item should hold automation through a per-item flag or through a
  migration-wide pause. Both work with the current `*/added` events; the per-item flag is
  safer across restarts but touches more tables.

Run the repository's typecheck, lint, formatting, ownership and test checks for
implementation changes. For this planning document, formatting validation is sufficient.
