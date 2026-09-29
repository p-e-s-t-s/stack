# Request-app compatibility — Seerr first

Implementation plan for the Phase 8 request-app integration in [PLAN.md](PLAN.md).
Planning only; no runtime changes are included.

## Goal and boundary

Ship optional `@magpiejs/compat-api` so request apps can configure Magpie as both a
Radarr and a Sonarr server, test connections, submit requests, extend existing TV
requests, and reconcile library and download state. Keep Magpie services authoritative;
the plugin translates contracts rather than implementing another media manager.

Target a pinned current stable Seerr release first. Overseerr and Jellyseerr are
secondary legacy targets: retain compatible behavior where practical, but do not make
legacy-only features prerequisites for the initial release. Record versions/commit SHAs in fixtures
before implementation; upstream develop branches are research references, not contracts.
Do not claim complete Radarr/Sonarr API compatibility.

`compat-api` is the roadmap's shared *arr API adapter name, covering request apps and
potential future Prowlarr integration. Use "Request-app compatibility" as its settings
label. Its contract is Radarr/Sonarr compatibility; Seerr is the primary consumer.

Out of scope: request approval/user management, Plex/Jellyfin scanning, full *arr
configuration APIs, Prowlarr indexer push, import exclusions, and independent HD/4K
copies of one title. Media-server scans remain the request app's responsibility.

## Repository findings

- `plugins/api/src/index.ts` fixes its route prefix to `/api/v1` and formats failures
  as `{ error }`. Compatibility needs its own paths, status codes and serializers.
- `plugins/auth/src/index.ts` already guards `/api/` and accepts `X-Api-Key` and
  `apikey` query parameters. Reuse that guard and Magpie-issued keys.
- Movies already provide lookup/add/update/search/remove services and optional automation.
- Series add uses TMDB IDs; Sonarr clients submit TVDB IDs. Series stores TVDB IDs,
  but the TMDB provider's existing ID mapper only resolves movie IMDb IDs.
- `SeriesService.monitorSeason` can update existing seasons, but add currently offers
  preset monitoring modes rather than an explicit requested-season set.
- Library owns folders/files; decision owns profiles; jobs owns persisted work.
  Cross-plugin writes must go through owner service methods.
- There is no existing compatibility plugin to extend in this checkout. The master
  plan anticipates one shared with Prowlarr; keep that future use possible.

## Routing and lifecycle

Expose two fixed, authenticated namespaces on the existing server:

| Configured service | Request-app URL base | Effective API prefix |
|---|---|---|
| Radarr | `/api/compat/radarr` | `/api/compat/radarr/api/v3` |
| Sonarr | `/api/compat/sonarr` | `/api/compat/sonarr/api/v3` |

Request apps append `/api/v3` to their configured URL base. Keeping both bases under
`/api/` preserves existing API-key authentication. Verify this setup with each pinned
client, including a reverse-proxy deployment prefix. Defer a bare `/api/v3` alias until
its single application identity and shared endpoint behavior have an explicit use case.

Register routes directly through `ctx.server`, using a small plugin-local JSON/error
wrapper. Avoid changing the v1 API helper solely for this feature. Inject server/auth,
library/decision/jobs/database; use separate optional movie and series child contexts.
Routes and job handlers disappear when their owning context unloads. Do not advertise a
backend whose media plugin is disabled. Reloading restores persisted work safely.

Return a deliberate compatible application identity/version per namespace. Define
supported capability behavior from client version checks; do not use Magpie's version
as a fabricated Sonarr version. Include Magpie identity in an additional field/header.
Sonarr v3 language-profile behavior and v4 behavior need separate fixture coverage.

## Endpoint contract

Exact casing matters: Overseerr's shared client calls `/qualityProfile`. Register the
observed casing plus `/qualityprofile`, or prove router case-insensitivity in tests.

| Endpoints below each API prefix | Required behavior |
|---|---|
| `GET /system/status` | Backend identity, compatible version and URL base; fields consumed by connection tests |
| `GET /qualityProfile`, `GET /rootfolder` | Stable IDs, profile names, kind-filtered folders and paths; actual filesystem capacity where consumed |
| `GET /tag`, `POST /tag` | Persistent numeric IDs/labels; retry-safe label creation |
| `GET /movie`, `/movie/:id`, `/movie/lookup` | Library listing, `tmdbId` filtering, detail and `term=tmdb:<id>` metadata lookup |
| `POST /movie`, `PUT /movie`, `PUT /movie/:id` | Add or update monitoring/profile/availability/tags, returning a Radarr-shaped movie |
| `GET /series`, `/series/:id`, `/series/lookup` | Library listing, `tvdbId` filtering, detail and `term=tvdb:<id>` lookup; title search if pinned clients use it |
| `POST /series`, `PUT /series`, `PUT /series/:id` | Add/update profile, type, season folders, monitoring, future monitoring and selected seasons |
| `GET /languageprofile` (Sonarr) | Only where required by the chosen v3 contract; map supported semantics honestly |
| `GET /episode?seriesId=...`, `/episode/:id` | Episode IDs, numbering, dates, monitoring and actual file linkage for client reconciliation |
| `GET /queue` | *arr pagination envelope with `records`; backend-specific movie/series/episode linkage and progress |
| `POST /command`, `GET /command/:id` | Durable `MoviesSearch` / `SeriesSearch` jobs and observable state; other commands only if recorded clients require them |

Deletion is a separate, later increment: `/movie/:id` and `/series/:id` DELETE must
honor `deleteFiles` through owner services. Enable only after validating request-app
removal workflows and documenting supported options. Reject unsupported destructive
options explicitly. Do not add endpoints just to return fake success.

## Translation rules and service changes

1. **External IDs:** extend metadata-provider `mapIds` for series TVDB-to-TMDB via
   TMDB's external-ID find endpoint. Prefer an existing local TVDB match; otherwise
   resolve and verify metadata. Cache mappings, reject missing/ambiguous matches, and
   never resolve identity from title alone. No TVDB subscription is needed for this
   route, but an enabled capable metadata provider is required.
2. **Profiles and folders:** expose existing IDs and only applicable profiles/folders.
   Resolve `rootFolderPath` to a configured root for that kind; reject unknown paths.
   Do not create directories or accept arbitrary paths from the compatibility payload.
   Inspect profile semantics before deciding which native profiles can be exposed.
3. **Monitoring:** add an explicit selected-season option to the series owner service.
   Apply selection during initial add before emitting `series/added` or scheduling
   search, so unrequested seasons cannot be searched transiently. Updates validate all
   seasons before mutation. Preserve unrequested existing seasons when the client's
   payload does so; apply explicit false values when it requests unmonitoring.
   Handle specials and `monitorNewItems` independently.
4. **Updates:** explicitly map supported fields; ignore harmless presentation fields
   from echoed lookup payloads. Reject unsupported behavior-changing fields. A changed
   root/path is either handled by an owner relocation operation or rejected; never
   silently move files as a side effect of an echoed PUT payload.
5. **Idempotency:** stable native library IDs, identity uniqueness and serialized or
   transaction-safe add-by-external-ID prevent concurrent duplicate additions. Repeated
   requests return existing items where the client workflow permits. Persist media,
   season selection and tags before accepting search work.
6. **Search:** translate addOptions to durable jobs rather than blocking an HTTP request
   on indexer searches. Use dedupe keys for repeated equivalent pending searches.
   Verify existing movie/series event listeners so each request queues work once.
   A queued search is not a downloaded file; missing dependencies must produce an
   explicit actionable error or visible failed command, never success with lost work.
7. **Availability:** `hasFile`, movieFile, episodeFileId and season statistics come from
   imported library files. Map partial series availability per season. Do not reuse
   aggregate native stats where their definition differs from Sonarr's denominator.
8. **Queue:** map download states/progress, sizes, IDs and unit relationships; support
   includeEpisode and observed filters/pagination. Do not imply an import is complete
   when the download merely completed. Track removed/imported downloads consistently.

Persist tags and media-tag associations in compatibility-owned `compatapi_*` tables
(namespace names must be lowercase letters/digits). They are request-app annotations,
not native automation rules. Use a kind discriminator, stable media IDs, owner deletion
events or explicit reconciliation, and avoid mandatory foreign keys to optional media
plugin tables. Use jobs' existing IDs/state for commands where practical; persist any
additional command metadata in compatibility tables, without mutating jobs tables.

## Delivery order

1. **Contract inventory:** capture sanitized HTTP traces for test-connection, profiles,
   folders/tags, new movie, existing movie, new selected-season show, another season,
   library sync and queue reconciliation. Pin clients and record required response
   fields, methods, query parameters, statuses and version branches.
2. **Connection layer:** scaffold plugin, authenticated namespaces, lifecycle cleanup,
   status, folders/profiles and tags. Document request-app settings. Exit: both backend
   connection tests pass in every target client.
3. **Movie requests:** serializers, lookup, add/update, retry handling and durable search.
   Exit: new/existing requests work and scans distinguish pending from imported files.
4. **TV requests:** provider ID mapping, atomic selected-season addition, updates,
   episode and season serializers. Exit: requesting a second season keeps prior requests
   and only searches monitored episodes; specials/anime/daily retain native numbering.
5. **Reconciliation:** queue and command state across retries/restarts, file availability,
   partial-season statistics and disabled dependencies. Exit: request-app sync reports
   accurate library and download state.
6. **Acceptance and docs:** live smoke matrix, setup/troubleshooting guide, optional
   deletion increment, release notes and explicit HD/4K limitation.

## Verification and acceptance

- Contract fixtures exercise the complete client sequence, not isolated happy-path JSON.
- Temp SQLite/service tests cover external-ID mapping failures, stable IDs, tags surviving
  restart, concurrent duplicate adds, unknown profile/root, malformed payloads and PUT
  preservation of fields outside the compatibility contract.
- Fake-indexer/download tests cover search requested once, selected seasons/specials,
  partial imports, queue state, failed search and restart before/after job acceptance.
- Route tests cover missing/revoked keys, both accepted key transports, base prefixes,
  casing, correct status/error bodies, disabling/re-enabling plugin dependencies, and
  no regression to native v1 routes. Keep secrets out of fixtures/logs.
- Required live tests in pinned stable Seerr: connect both backends,
  choose settings, request movie/TV seasons, retry, reconcile downloads and import,
  restart Magpie and repeat sync. Test media-server availability through the request
  app's own integration rather than claiming this shim replaces scanning.
  Run Overseerr/Jellyseerr legacy smoke tests afterward; document gaps separately.
- Run repository typecheck, lint, formatting, migration ownership and relevant test
  suites after implementation. No runtime tests are needed for this planning document.

Done means request submission and reconciliation pass the pinned Seerr matrix, not
merely that settings report a successful connection. Legacy support is claimed only
for versions whose smoke tests pass.

## Research references

Upstream source inspected on 2026-09-29; pin snapshots during contract inventory:

- [Seerr unification announcement](https://docs.seerr.dev/blog/seerr-release/)

- [Overseerr shared Servarr client](https://github.com/sct/overseerr/blob/develop/server/api/servarr/base.ts)
- [Overseerr Radarr client](https://github.com/sct/overseerr/blob/develop/server/api/servarr/radarr.ts)
- [Overseerr Sonarr client](https://github.com/sct/overseerr/blob/develop/server/api/servarr/sonarr.ts)
- [Seerr Radarr client](https://github.com/seerr-team/seerr/blob/develop/server/api/servarr/radarr.ts)
- [Seerr Sonarr client](https://github.com/seerr-team/seerr/blob/develop/server/api/servarr/sonarr.ts)
- [Radarr API](https://radarr.video/docs/api/) and [Sonarr API](https://sonarr.tv/docs/api/index)

Open checks resolved in step 1: exact Jellyseerr release behavior, profile kind filtering,
version-dependent language fields, sync/queue consumers outside the API wrappers,
statistics definitions, and any commands or deletion routes used by those consumers.
