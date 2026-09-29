# Phase 7 — Subtitles / Bazarr replacement

Implementation plan; no subtitle runtime is implemented by this document.

## Outcome and scope

Movies and episode files acquire the subtitles required by their assigned profile,
automatically after import and through periodic reconciliation. Users can inspect
embedded and external subtitles, search manually, replace a managed subtitle, upgrade
it until a cutoff, and optionally synchronize its timing.

Build on the native library, not Radarr/Sonarr polling. First delivery covers movies
and standard TV, SRT/ASS/SSA/WebVTT text sidecars, embedded stream detection, one
provider, automatic downloads, manual selection, upgrades, and optional sync. Image
subtitles are inventoried but not converted or OCR'd. Anime absolute numbering,
episode packs, translation, transcription, remuxing, and Bazarr migration follow later.

## Integration and ownership

- `plugins/subtitles` owns `ctx.subtitles`, profiles, assignments, inventory, matching,
  acquisition records, wanted state, retry policy, and console/API operations. Required
  services: database, library, jobs. Movies, series, webui, history, and import integrate
  through optional injection; disabling subtitles removes its jobs and UI.
- Provider plugins register adapters for their lifetime. Start with
  `plugins/subtitles-opensubtitles`; add SubDL next. Podnapisi and Addic7ed need a
  current API/access feasibility review before commitment. Provider code owns auth
  and response translation; core code owns selection and writing files.
- Add provider/context contracts to `packages/types`. Reuse `packages/http-utils`
  for transport throttling and retries, and `ctx.jobs` for persisted work.
- Library continues to own media/files/paths. Subtitle tables reference
  `library_media_items` and `library_media_files`; never modify library-owned tables
  from subtitle migrations. Series provides episode identity through an owner API,
  including every episode linked to a multi-episode file.
- The actual events are `library/file-added`, `library/file-removed`, and
  `import/completed`. `library.updateFile()` currently emits `library/file-added` too:
  treat events as reconciliation hints and inspect file generation before doing work.
  Add an explicit file-change event only if needed, through library itself.
- There is currently no stored ffprobe output in `library_media_files`. Introduce a
  bounded probe runner and subtitle-owned probe cache first; do not assume the roadmap's
  proposed `mediainfo` column exists. A later shared probe service can replace it.
- Extend history's owner contract with subtitle download/upgrade/sync/failure events;
  history currently accepts only grab/import event types. Persistent acquisition state
  remains in subtitles even if history is disabled.

## Profiles and assignment

A profile contains named requirements. Each requirement specifies a canonical language
tag (including variants such as `pt-BR`), forced mode, hearing-impaired policy, whether
embedded streams count, minimum match score, upgrade cutoff, and accepted formats.
Normalize provider ISO aliases at adapter boundaries; retain region/script distinctions.

Forced modes are **full**, **forced**, or **either**. HI policies are **require**,
**prefer**, **exclude**, or **either**. Full and forced subtitles in one language are
separate requirements. A preferred HI variant is a ranking bonus; it is not a rejection.
Unknown language/forced/HI metadata stays unknown and cannot satisfy a strict rule.
Record whether flags came from container disposition, filename, or provider metadata.

Profile-level controls: automatic acquisition, monitored-only policy, upgrades enabled,
upgrade window, sync policy (`off`, `best-effort`, `required`), and sync engine. Validate
cutoff >= minimum. Show score explanations instead of implying a percentage measures
translation quality. Default: no automatic work until the user chooses a profile;
embedded subtitles count, upgrades off, sync off, and manual sidecars protected.

Assignment precedence: explicit movie/series assignment (including explicit disabled)
over kind default. Series assignment applies to its files. Episode overrides can be
added later without changing the requirement evaluator. Default changes recompute
inheriting items only; profile edits increment a revision and invalidate affected work.
Deleting an assigned profile requires reassignment or disabling those assignments.

## Inventory and embedded/external detection

Resolve files with `library.folderOf(item)` and the library-relative file path. Probe
with ffprobe JSON using argument arrays, bounded output, timeout, and cancellation.
Cache by file ID plus size/mtime and a generation token; invalidate on change. Keep
duration, audio languages, subtitle codec, stream index, language, title, and dispositions.
Text and image streams both count if permitted by the profile. No embedded mutation.
Unknown flags and ambiguous track titles are visible for manual correction.

Scan exact video-basename sidecars and recognized suffixes, for example
`Movie.en.srt`, `Movie.en.forced.srt`, and `Movie.en.hi.ass`. Never attach every subtitle
in a series folder to every video. Record SRT/ASS/SSA/VTT, and paired IDX/SUB as image
inventory; extension alone does not make a file valid. Parse text formats and flags,
normalize language aliases, and offer manual association for ambiguous names.

Do not infer subtitle language from the library file's existing `languages` field.
Unlabelled files remain unknown. Verify readable bytes, valid cues, and nonempty text.
Failure to probe or read a directory produces **inventory unknown**, not **missing**;
defer automatic acquisition until the inventory is trustworthy.

Keep unmanaged sidecars and managed downloads distinguishable. On rescan, verify
managed files by checksum; if the user changed one, protect it from automatic replacement.
Reconciliation marks missing inventory only after a successful scan. Removing a library
record removes inventory through cascading references but does not itself delete sidecars.
Renames/moves require an explicit owner coordination hook for managed sidecars; preserve
unmanaged files and surface anything that cannot be moved safely.

## Provider contract and matching

An adapter exposes instance ID, capabilities (languages, kinds, flags, formats, hash
lookup), health/test, `search(context, requirement, signal)`, and
`download(candidate, signal)`. Search context includes IDs, alternate titles, year,
release name/group, file size/hash/duration, and complete episode identity. Candidates
contain stable provider IDs, subtitle/file IDs, evidence, language/flags/format,
download metadata, and raw provider score kept separate from Magpie's score.

Use one versioned, explainable score model across adapters. Hard-reject conflicting
movie IDs, episode identity, explicit language/variant or required flag mismatches.
Treat insufficient identity separately from a low score. Hash matches are strongest;
exact episode/movie identity, release match, group, source, and runtime strengthen
confidence. Missing fields are not matches. Hash does not override a known identity
conflict. Title-only candidates require manual selection initially.

Initial normalized score bands: verified file hash 100; verified identity plus exact
release 90; verified identity with compatible release evidence 80; verified identity
alone 60. Suggested automatic minimum 80 and cutoff 90, subject to fixture calibration.
Use HI preference and provider priority as tie-breakers, not fabricated identity evidence.
Store scoring version and evidence so existing candidates can be re-evaluated.

Deduplicate stable provider/file IDs and downloaded content hashes. Manual search shows
every rejection reason and evidence. Users may select a low-confidence candidate with
an explicit mismatch warning; identity mismatch overrides require a distinct confirmation.
Ambiguous multi-episode results stay manual unless the subtitle covers the entire file.

Provider settings include credentials, priority, enabled state, and concurrency. Keep
credentials in established server configuration, mask responses, and redact logs. Persist
quota/reset state per account instance; respect server reset information and Retry-After.
Separate no-results, rate-limit, quota-exhausted, authentication, temporary outage, and
malformed-response outcomes. An unavailable provider does not fail other providers.
Do not hardcode daily quotas or reset timezone; retain unknown quota as unknown.

## Wanted state and automatic jobs

Evaluate per `(mediaFileId, generation, requirementId, profileRevision)`:

| State       | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| disabled    | No effective assignment, automation off, or monitoring excludes file     |
| unknown     | Inventory or required identity cannot be established                     |
| missing     | Inventory complete; no acceptable subtitle satisfies requirement         |
| satisfied   | Acceptable inventory exists; no automatic replacement is needed          |
| upgradeable | Managed scored subtitle below cutoff and inside upgrade window           |
| waiting     | Missing/upgradeable with future retry, quota reset, or provider recovery |
| blocked     | Invalid credentials, unwritable target, missing required sync tool, etc. |

Job activity is a separate dimension so queued/running work does not erase the reason
a file is wanted. Store reasons and next eligible search time. Derive satisfaction from
inventory; cached wanted rows are disposable projections and must reconcile at startup.

Triggers: file add/change, completed import, assignment/profile edits, monitoring changes,
provider availability changes, manual actions, startup reconciliation, and scheduled
inventory/wanted/upgrade sweeps. Subscribe after import associations are committed;
if episode links are not ready, defer rather than search with guessed episode metadata.
Adopted files must work without an `import/completed` event.

Jobs: `subtitles.scan`, `subtitles.search`, `subtitles.acquire`, `subtitles.sync`, and
bounded sweep jobs. Dedupe by file generation and requirement, and serialize commits
per file/requirement. The existing jobs queue dedupes active work but does not provide
all subtitle locking semantics: implement and test the additional lock explicitly.

Proposed defaults: daily inventory reconciliation; hourly wanted/upgrade dispatch;
no-results retries after 6h, 24h, then every 3 days, with jitter. New file generations
reset no-results backoff. Throttle each provider and bound sweep batches. A manual search
bypasses no-results delay but still respects provider quota/rate limits. Transient errors
use transport/job retry; absence of candidates schedules future eligibility without
burning failure attempts. Stop automatic searches when satisfied or cutoff is met.

## Download, validation, and commit

1. Re-read effective profile, inventory, monitoring, and media generation before spending
   download quota. Choose the best qualifying candidate; fallback to the next on invalid
   content, within a bounded attempt budget.
2. Download to staging, with response-size and archive-expansion limits. Reject traversal,
   links, executables, and ambiguous archive members. Never persist temporary download URLs
   as durable candidates; refresh them through the adapter when needed.
3. Detect encoding, normalize text to UTF-8, parse cues, verify actual format and plausible
   timestamps against media duration. Encoding ambiguity becomes a visible failure, not
   silently corrupted text. Preserve ASS styling; do not force every format into SRT.
4. Apply configured sync to staging. Required sync failure prevents installation;
   best-effort failure may install the validated original with visible unsynced status.
5. Recheck file generation/profile and current destination under the commit lock. Name
   sidecars from the current video basename: `Movie.en.forced.srt`,
   `Episode.pt-BR.hi.ass`. Do not overwrite an unmanaged or user-modified file.
6. Persist an acquisition intent, stage on the destination filesystem, back up a managed
   replacement, and rename into place. Finalize inventory/provenance and emit success
   only after filesystem installation succeeds.

SQLite and filesystem changes are not a shared transaction. A durable operation journal
records expected old/new hashes, staged path, backup path, and commit stage. Startup recovery
must finish or roll back interrupted installs idempotently. Path containment checks include
symlinks and Windows case collisions. Keep bounded backups for undo/recovery and never
edit the media file. Changed media during download causes stale work to be discarded.

## Upgrades

Automatic replacement applies only to unchanged Magpie-managed external subtitles with
known scoring evidence. Embedded and unmanaged files can satisfy a requirement but are
not automatic upgrade targets. Manual adoption can enable management after confirmation.

A candidate must remain acceptable and score strictly above the installed subtitle,
with a configurable minimum delta (suggested 5). Equal scores and duplicate content
never replace. The upgrade window starts at first successful acquisition for that file
generation, not the latest upgrade; suggested window 30 days when upgrades are enabled.
Cutoff satisfaction, user protection, or window expiry stops automatic upgrades. Manual
replacement remains available. Sync status alone does not change the match score.

## Timing sync

Provide a sync adapter boundary with manually applied offset as the simplest operation,
then an external engine. Configure an explicit executable path; validate availability
and report capabilities instead of installing tools automatically. Engines accept input,
reference, staging output, timeout, and AbortSignal; invoke without a shell.

Prefer a known-good same-language text reference when supported; otherwise use the video's
audio through the configured engine. Require a supported format and suitable reference;
forced or sparse subtitles need special caution and should default to manual sync.
Embedded image tracks are not text sync references. Never overwrite an input in place.

Store engine/version, reference, input/output hashes, timestamp, and result
(`pending`, `succeeded`, `failed`, `skipped`). Validate output cues, duration, and bounded
timing changes before committing. Process success is not proof of accurate alignment;
offer preview/sample timestamps, offset adjustment, and undo. Auto-sync failure must not
cause a download loop. Changing the sync policy schedules sync on eligible existing files
without re-downloading them. ASS requires an engine that preserves its structure.

Reference implementations: [ffsubsync](https://github.com/smacke/ffsubsync) and
[alass](https://github.com/kaegi/alass). Confirm supported formats and platform packaging
against each engine's documentation during adapter implementation.

## Proposed subtitle-owned data

| Table                      | Contents / invariants                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `subtitles_profiles`       | Name, revision, automation/upgrade/sync controls                                                                             |
| `subtitles_requirements`   | Profile FK, stable ID, language/flags/formats, minimum/cutoff; unique normalized requirement                                 |
| `subtitles_assignments`    | Media PK/FK, explicit profile or disabled; absence means inherit                                                             |
| `subtitles_settings`       | Kind defaults and scheduler/retention settings                                                                               |
| `subtitles_probes`         | File PK/FK, generation/fingerprint, probe facts/status/error                                                                 |
| `subtitles_inventory`      | File FK, external path or stream index, codec/flags/evidence, hash, managed/protected status; unique location per generation |
| `subtitles_acquisitions`   | Inventory/file references, provider IDs, score/version/evidence, first-acquired time, provenance and sync outcome            |
| `subtitles_wanted`         | Unique file/requirement projection, revision/generation, reason, retry time and last outcome                                 |
| `subtitles_provider_state` | Instance/account key, health, cooldown, quota/reset information; no plaintext credentials                                    |
| `subtitles_operations`     | Durable install/sync/replace journal and bounded undo backups                                                                |
| `subtitles_blocklist`      | Provider candidate or content hash, file generation/requirement scope, reason/expiry                                         |

Use cascades for library deletion and restrict profile deletion while assigned or defaulted.
Do not delete recoverable operation metadata before staged/backup files are reconciled.
Keep separate requirement-to-inventory evaluations since one track can satisfy more than
one non-conflicting requirement. Index wanted eligibility, file inventory, and provider keys.

## Console and API

- Settings: profile editor, kind defaults, provider configuration/test/quota, sync engine
  health, retry/retention settings. Display the effective assignment and inheritance.
- Movie/episode detail: Subtitles tab with embedded/external inventory, provenance,
  unknown flags, wanted reasons, score/cutoff, sync status, search, scan, manual download,
  replace, offset/sync, protect/adopt, blocklist, and undo actions.
- Wanted subtitles page: filters for missing/upgradeable/unknown/blocked, language,
  kind, provider, and monitoring; batch profile assignment, scan, and search.
- Activity/history: cancellable jobs and subtitle outcomes with actionable failures.
  Queued mutations return operation/job IDs. Detail views refresh from inventory events.
- Expose the same validated service operations through authenticated `/api/v1/subtitles`
  routes; mutating requests use POST/PUT/DELETE and enforce existing auth policy. Manual
  search candidates expire and are checked again at acquisition, not accepted as arbitrary
  client-provided download URLs. Optional providers/details disappear on plugin disposal.

## Delivery sequence and acceptance

| Step | Work                                                                                    | Exit evidence                                                                                                          |
| ---- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 7a   | Contracts, schemas, assignments, probe runner, sidecar inventory, pure wanted evaluator | Real embedded/external fixtures produce correct wanted reasons; probe failure cannot trigger a duplicate download      |
| 7b   | OpenSubtitles adapter, scoring, quotas, manual search/download, journaled commit        | Manual acquisition writes a valid sidecar; credential/quota failures are visible; unmanaged files remain intact        |
| 7c   | Import/file triggers, startup reconciliation, bounded sweeps and retries                | Movie, episode, and adopted files acquire required languages exactly once across restart and duplicate events          |
| 7d   | Protected upgrades, cutoff/window, blocklist, undo                                      | Only a qualifying better managed subtitle replaces; old bytes survive failed replacement and can be restored           |
| 7e   | Offset and external sync adapters, optional/required policy                             | Valid sync output commits safely; missing binary, timeout, cancellation, and bad output preserve recoverable originals |
| 7f   | Full console/API, history, SubDL adapter, packaging/docs                                | End-to-end profile assignment through wanted/search/download/upgrade/sync works with runtime enable/disable            |

Test meaningful boundaries: ISO aliases and regional languages; full/forced/HI/unknown
flags; text/image streams; ambiguous sidecars; multi-episode files; identity mismatch despite
high score; deterministic scores; quota reset and provider isolation; archive traversal and
oversize downloads; malformed/encoded files; generation/profile changes mid-download;
concurrent manual/automatic replacement; user-edited files; crash at every commit stage;
read-only roots; Windows filenames; disposal/cancellation; sync validation and undo.
Use sanitized provider fixtures and opt-in live smoke checks, never live credentials in CI.
Run typecheck, lint, ownership, relevant tests, and build when implementation lands.

## Deferred migration and implementation gates

Bazarr migration follows the native lifecycle: read a copied DB/config, preview profile
and path mappings, import supported settings through subtitle owner APIs, then rescan
actual files. Existing sidecars remain unmanaged until explicit adoption; source scores
do not become trusted Magpie scores. Provider secrets require explicit handling/re-entry.

Before 7b, verify the current [OpenSubtitles REST contract](https://opensubtitles.stoplight.io/docs/opensubtitles-api),
authentication, app key requirements, hash algorithm, and account quota responses using
official documentation and fixtures. Validate provider access for subsequent adapters
before promising them. Before 7e, choose a packaged sync engine based on format support,
license/distribution requirements, Windows support, and resource use. These are delivery
gates, not reasons to postpone inventory/profiles work.
