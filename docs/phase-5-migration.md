# Phase 5 — Radarr / Sonarr migration

Implementation plan for the migration part of [PLAN.md](PLAN.md#phase-5--migration--library-scan).
Library scanning is already built (see [library-import.md](library-import.md)); TRaSH Guides
import remains a separate, unstarted feature. This document proposes behavior and contracts; source API/schema compatibility must be verified during adapter work.

## 1. Goal and scope

Bring an existing movie and TV library into Magpie without moving or renaming its files,
preserving monitoring and release decisions wherever Magpie can represent them. Every
source record must have an explained outcome: imported, reused, explicitly excluded,
blocked, or failed. A successful migration does not imply exact feature parity.

Build `@magpiejs/migrate-arr` as an optional plugin with a Settings → Migration page.
Support multiple sources, with Radarr and Sonarr imported independently into one library.
Migration is a one-time transfer with resumable retries, not continuous synchronization.

First release:

- Connect through a source API, capture a local snapshot, and preview before applying.
- Import movies, series, seasons, episodes, monitoring, availability, dates added,
  existing file records and file-to-episode links.
- Explicitly map root paths and quality profiles; translate only supported profile and
  custom-format semantics. Preserve original source values in migration provenance.
- Reconcile duplicates and conflicts without overwriting existing library records by default.
- Export a redacted JSON report and readable summary; cancel and resume safely.

Follow-up releases complete the roadmap scope:

- Read-only SQLite adapters using consistent backup files and an explicit schema matrix.
- Optional history for a selected period, tags, indexers and download-client configuration.
- Additional profile/custom-format translations validated against source behavior.

Exclude active download ownership, automatic removal of the old applications, Bazarr data,
subtitle settings, remote filesystem transfer, and source-side changes. Existing downloads
finish in the old application before final cutover.

## 2. User flow

1. **Connect:** choose Radarr or Sonarr, enter URL/API key, test connectivity, and detect
   capabilities. Keep credentials server-side and redact them from all reports and logs.
2. **Snapshot:** collect library and configuration data with progress and cancellation.
   Record source identity, detected version, capture times and a content digest. An API
   capture is not transactionally consistent: detect changed records where possible and
   report consistency limits. Recommend pausing source activity for the final capture.
3. **Map:** map source roots to paths accessible to the Magpie server; map each profile to
   an existing profile or a proposed translated copy. Show identity, path and policy conflicts.
4. **Preview:** show counts and per-record differences, missing files, unsupported fields,
   and proposed decisions. Resolve blockers or explicitly exclude their dependent records.
   Acknowledge lossy translations individually; no silent defaults for decision policy.
5. **Apply:** take a destination backup, validate the approved plan, then run a background
   job. Show progress, current phase, failures and safe cancellation at record boundaries.
6. **Verify and cut over:** compare source/destination counts, identities, paths, episode
   links and monitoring; export the report. Resume Magpie automation only after review,
   stop old application automation, and perform one controlled search/import in Magpie.

Preview writes only migration-owned staging/report data. It creates no library records,
directories or media files and schedules no searches or downloads. Applying also leaves
media files in place. Scheduled and RSS-driven automation must be gated for affected items
throughout apply and verification, including across restarts.

## 3. Fit with the current code

| Existing component                         | Required change                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/movies`                           | Add a validated ingestion method accepting normalized source metadata, exact folder, original dates and availability without lookup or search side effects.            |
| `plugins/series`                           | Add equivalent ingestion for seasons/episodes and exact monitoring; resolve TVDB-only records to the required TMDB identity before apply.                              |
| `plugins/library`                          | Add path-preserving record ingestion and file upsert; support registration of existing roots without `mkdirSync`. Decide and expose multiple external roots in the UI. |
| `plugins/decision`                         | Validate proposed translations and create profiles/formats/scores through owner APIs, including explicit handling of global quality-size conflicts.                    |
| `plugins/history`                          | Add an ingestion method preserving timestamps and source event identity; unsupported event kinds remain in the report until a supported representation exists.         |
| `plugins/jobs`                             | Run snapshot/apply/verification jobs with durable per-record checkpoints, cancellation and deduplication.                                                              |
| `plugins/database`                         | Expose/reuse backup and synchronous transaction facilities for an item plus its migration ledger.                                                                      |
| `plugins/api`, `plugins/auth`, console kit | Authenticated migration endpoints, credential-safe payloads and a Settings navigation entry.                                                                           |

Do not call the ordinary `movies.add()` or `series.add()` flows and then patch their results:
they fetch metadata, render new folder names and emit add events that can start automation.
Keep each destination write in its owning service; the migration plugin orchestrates these
services and owns only `migratearr_*` tables. Introduce a shared transaction context where
necessary so library/details/files/links and ledger commit atomically per item. All network
lookups and filesystem checks happen before the synchronous transaction.

Sonarr identity is a first-class prerequisite: the current series schema requires a unique
TMDB ID. Use the existing metadata abstraction if it can resolve TVDB IDs, otherwise add
that capability. Unresolved or ambiguous matches block that series; never guess from title
alone. Preserve source season/episode numbering. Detect numbering differences with provider
metadata, and keep automatic refresh from replacing migrated mappings until reconciled.

## 4. Pipeline and durable state

Use one pipeline for both transports:

`source adapter → normalized snapshot → mappings → immutable plan → owner services → verification`

Adapters produce source-independent records for roots, profiles, formats, media, episodes,
files and optional history/configuration. Every record carries source type, source-instance
ID, entity type, source ID, content hash and field-level translation diagnostics. Numeric
IDs are local to a source; Radarr and Sonarr IDs must never collide in Magpie's ledger.

Suggested migration-owned tables:

- `migratearr_sources`: stable instance identity, transport and safe connection metadata.
- `migratearr_runs`: state, snapshot/plan digests, mapping revision, progress, backup reference.
- `migratearr_records`: normalized records, proposed action, diagnostics and apply result.
- `migratearr_mappings`: root, profile, quality, format and external-ID decisions.
- `migratearr_entities`: durable source-to-destination ledger with destination fingerprint.

Run states: `capturing → mapping → ready → applying → verifying → completed`, with
`failed` and `cancelled` states retaining checkpoints. Completion requires no unresolved
blockers or failures; acknowledged exclusions and warnings remain visible in the report.
Resume revalidates the saved snapshot, target records and mappings before continuing.

Applying requires the reviewed plan digest. Mapping changes require a new preview. If an
existing destination record changes after preview, block that action and request replanning.
Use a single apply lock for shared roots/profiles and identity checks. Crash recovery must
not create a destination item without its ledger or record a ledger for an uncommitted item.
Repeat imports from the same source reuse the ledger; another source matches stable external
IDs and validated paths. Names are display data, not deduplication keys.

Candidate endpoints under `/api/v1/migrations`: source test, snapshot creation, run status,
mapping update, preview, apply, cancel, resume and report export. The web console uses the
same service methods. Require administrator access using the existing auth capabilities;
if role distinctions are unavailable, settle the authorization contract before implementation.

## 5. Mapping and conflict rules

| Data               | Rule                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movie identity     | Match TMDB ID; inconsistent IMDb/path identity is a conflict.                                                                                                                               |
| Series identity    | Resolve and validate TMDB/TVDB identity; preserve both IDs.                                                                                                                                 |
| Monitoring         | Preserve item, season, episode and future-monitoring decisions separately. Unsupported future rules require a visible mapping.                                                              |
| Paths              | Map root prefixes on segment boundaries using source path syntax, then validate with destination OS rules. Preserve nested item folders and relative file paths.                            |
| Files              | Check readability, containment and size; preserve quality, languages, revisions and dates. Multi-episode files create one file record with several episode links.                           |
| Missing files      | Keep the title if selected, but exclude its unavailable file record with an explicit report entry. Do not claim it is downloaded.                                                           |
| Existing media     | Default to reuse with no changes. Show all differences; permit filling missing file links only after explicit conflict resolution.                                                          |
| Profiles           | Reuse by semantic equivalence or create a source-prefixed copy; names alone do not establish equivalence.                                                                                   |
| Formats and scores | Translate supported predicates, negation, requirements and scoring. Block affected profile translation when semantics cannot be preserved; allow explicit remapping to an existing profile. |
| Quality sizes      | These are global in Magpie. Conflicting Radarr/Sonarr values need an explicit winner or retained destination values, affecting both sources.                                                |
| History            | Preserve supported event types and original timestamps; dedupe by source event ID. Orphan/unsupported events receive explained exclusions.                                                  |
| Tags               | Preserve source tag data in provenance first; functional migration waits for an owner service and destination semantics.                                                                    |
| Clients/indexers   | Later opt-in import as disabled configurations, with supported-provider validation and connection tests before activation.                                                                  |

Reject traversal, path escape via symlinks, overlapping ambiguous mappings, file ownership
conflicts and multiple files competing for one episode (the destination currently permits
one file per episode). Do not relabel unknown file quality as a known quality. Report it and
require a mapping. Recompute destination format scores only under a translated/mapped policy;
retain source scores in provenance rather than claiming equivalent release decisions.

Preserve secrets only through an established protected credential mechanism, or hold them
in memory and ask for re-entry after restart. Never put credentials in job payloads or
staged raw configuration. Permit private/LAN source addresses for this self-hosted use case,
while restricting protocols, validating redirects and avoiding credential forwarding.

## 6. Failure recovery

Use bounded requests, timeouts, pagination and retry/backoff for transient source failures.
Authentication and unsupported schemas fail with actionable diagnostics. Freeze the snapshot
for apply; a refreshed snapshot produces a new plan, not silent edits to an active run.

Cancellation stops after the current atomic item. Completed records remain visible and can
be resumed without duplicates. Retain failed records and reasons rather than restarting the
whole library. Configuration writes follow their own checkpointed dependency order:
roots/formats/profiles before media, files/episode links with media, then optional history.

Provide a pre-apply database backup and clear restoration instructions. Restoring replaces
all destination changes since that backup, so it is a separate deliberate operation with
Magpie stopped. Do not offer automatic compensating deletion of records that users may have
edited or other plugins may now reference. The migration never needs to restore media files.

For SQLite input, accept a consistent source-generated backup or stopped-instance snapshot.
Opening a copied live main database read-only does not guarantee consistency when WAL data
is missing. Validate schema capabilities before querying, operate on a local read-only copy,
and reject unsupported layouts rather than attempting best-effort SQL writes or conversions.

## 7. Delivery sequence

1. **Contracts and fixtures:** choose the initial supported source versions, capture sanitized
   API examples, inventory field semantics and define normalized records/diagnostic codes.
   Use public documentation and observed data; do not copy upstream implementation or tests.
2. **Destination prerequisites:** path-preserving roots/items/files; transactional owner
   ingestion; series identity resolution; exact monitoring; automation and refresh gates.
3. **API snapshot and preview:** adapters, staging schema, mappings, read-only path checks,
   conflict detection, immutable plans, Settings wizard and report export.
4. **Apply and verification:** backup, apply lock, durable ledger, cancellation/resume,
   per-item atomicity and reconciliation. Ship the first release after real-library testing.
5. **SQLite transport:** schema-specific adapters producing the same normalized contracts,
   backup consistency checks and parity tests against API captures.
6. **Extended migration:** history, supported tags/configuration and additional format rules.
   Keep incompatible data visible until implemented or explicitly excluded.

Do not make TRaSH import a prerequisite for importing an already identified source library.
Reuse the existing scan and adoption helpers for file validation where useful.

## 8. Acceptance criteria

- Fixture coverage includes movie files, missing movies, specials, daily/anime series,
  mixed episode monitoring, multi-episode files, multiple roots, Windows/Unix path mappings,
  conflicting profiles and unsupported custom-format rules.
- Preview makes no destination library/configuration/filesystem changes and starts no searches.
- Apply preserves exact mapped paths and monitoring and never moves, renames or deletes files.
- An interrupted/retried run and a repeated import create no duplicate media, files or history.
- A crash during an item leaves both owner records and ledger committed, or neither.
- Existing destination edits invalidate affected planned actions; source IDs from different
  instances cannot alias each other.
- Automatic search, RSS processing and destructive episode refresh cannot race apply or
  silently change imported data before review.
- Reports account for every source record and include field-level reasons for loss/exclusion.
  Credentials are absent from snapshots, exports, logs and queued job data.
- A real Radarr and Sonarr library passes reconciliation with zero unexplained mismatches,
  followed by a successful controlled Magpie search/download/import after cutover.

Run the repository's typecheck, lint, formatting, ownership and test checks for implementation
changes. For this planning document, formatting validation is sufficient.
