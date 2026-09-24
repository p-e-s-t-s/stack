# Implementation Plan: Unified Media Manager

A single-process replacement for Radarr, Sonarr, Prowlarr and Bazarr, built on the
[Cordis](https://github.com/cordiverse/cordis) plugin kernel with a Cordis WebUI console
that plugins extend with their own pages, widgets and actions.

> **Working name:** `cordarr` (npm scope `@cordarr/*`). Placeholder only; renaming is a
> search-and-replace until the first release.

---

## 0. Stack corrections (verified against npm, 2026-09)

The notes this plan was based on described the Cordis web stack as Koa-based. The
published packages say otherwise, and the plan follows the packages:

| Package | Version | What it actually is |
|---|---|---|
| `cordis` | `4.0.0-rc.x` | Plugin kernel. **v4 is still a release candidate**; pin exact versions. |
| `@cordisjs/plugin-server` | `1.7.x` | HTTP + WebSocket server (`ctx.server`). Its own router on `path-to-regexp` + `ws`. **Not Koa.** |
| `@cordisjs/plugin-server-proxy` | `1.2.x` | Proxy routes on top of `server`. |
| `@cordisjs/plugin-http` | `1.5.x` | Outbound HTTP client (`ctx.http`). We use it for every external API. |
| `@cordisjs/plugin-webui` | `0.8.x` | The console backend (`ctx.webui`): serves the client, entries, WebSocket RPC. |
| `@cordisjs/client` | `0.8.x` | Console frontend: Vite 7, Vue 3.5, Element Plus, UnoCSS. |
| `@cordisjs/components` | `0.4.x` | Shared console components, incl. schemastery-driven forms (`schemastery-vue`). |
| `@cordisjs/plugin-loader` | `1.0.0-rc` | YAML-configured plugin loading; enable/disable/reload plugins at runtime. |
| `@cordisjs/plugin-timer` | `1.1.x` | Disposable timers (`ctx.setInterval`, etc.). |
| `@cordisjs/plugin-logger` | `1.0.x` | Logging. |
| `schemastery` | `3.18.x` | Config schemas; the console renders settings forms from them. |

**Not used:** the ready-made console pages — `@cordisjs/plugin-server-webui` (route
inspector), `@cordisjs/plugin-http-webui` (HTTP inspector), `@cordisjs/plugin-loader-webui`
(generic plugin manager) and `@cordisjs/plugin-market` (npm plugin installer). We use only
the core infrastructure (kernel, server, http, loader, timer, logger, webui backend,
client, components) and build every page ourselves, so the UI is a media manager rather
than a developer console. There is no standalone-Vue fallback: the UI lives in the Cordis
WebUI ecosystem.

Consequences:
- Routes are registered with `ctx.server.get/post(...)`, not Koa middleware. If a Koa
  middleware is ever needed, wrap it in an adapter; don't add a second HTTP server.
- Because Cordis v4 is an RC, `packages/core` wraps the few Cordis APIs we lean on so a
  breaking RC bump is fixed in one place. Renovate PRs for `cordis` / `@cordisjs/*` are
  manual-merge only.
- **Node:** the plan targets Node 24 LTS (the dev container currently has Node 22; CI
  and Docker pin 24).

## 1. Goals and non-goals

**Goals**
- One process, one SQLite file, one web UI for movies, TV, indexers and subtitles.
- Every integration (metadata source, indexer, download client, subtitle provider,
  notifier) is a Cordis plugin that can be enabled, reconfigured or removed at runtime
  without restarting.
- Drop-in migration from an existing Radarr/Sonarr/Prowlarr/Bazarr setup, including an
  existing library on disk.
- Compatible enough with the Radarr/Sonarr v3 API that Prowlarr sync and
  Overseerr/Jellyseerr work unchanged.

**Non-goals (v1)**
- Music/books (Lidarr/Readarr). The media model shouldn't rule them out, but no work.
- Multi-user accounts and permissions beyond a single admin + API keys.
- Transcoding or playback.
- Clustering/horizontal scaling.

## 2. Tech stack

| Area | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript (strict), ESM only |
| Monorepo | npm workspaces, TypeScript project references, `tsup` for builds, `tsx` for dev |
| Kernel | `cordis` 4 + `@cordisjs/plugin-loader` (YAML config) |
| HTTP in | `@cordisjs/plugin-server` |
| HTTP out | `@cordisjs/plugin-http` (+ per-host rate limiter we add) |
| UI | `@cordisjs/plugin-webui` + `@cordisjs/client` + `@cordisjs/components` (Vue 3, Element Plus, UnoCSS). Core only; all pages are ours |
| DB | SQLite via Drizzle ORM. Driver: `better-sqlite3`, behind an adapter so `node:sqlite` can replace it once it's stable (no native build = easier ARM/Docker) |
| Config schemas | `schemastery` |
| Tests | Vitest; `msw` for HTTP mocks; Playwright for a few UI smoke tests |
| Media probing | `ffprobe` (bundled in Docker image) |
| Lint/format | ESLint (flat config) + Prettier |
| License | MIT |

## 3. Architecture

```
                         ┌──────────────────────────────────────┐
                         │ cordis Context + loader (YAML config) │
                         └──────────────────┬───────────────────┘
        ┌────────────┬─────────────┬────────┴───────┬──────────────┬─────────────┐
   ┌────▼───┐  ┌─────▼────┐  ┌─────▼─────┐  ┌───────▼──────┐  ┌────▼─────┐ ┌─────▼──────┐
   │   db   │  │  jobs    │  │  library  │  │   decision   │  │ pathmap  │ │  notify    │
   │(SQLite)│  │(persisted│  │(media,    │  │(parser, CFs, │  │(remote → │ │ (fan-out)  │
   │        │  │ queue)   │  │ files,    │  │ scoring)     │  │  local)  │ │            │
   └────────┘  └──────────┘  │ scanning) │  └──────────────┘  └──────────┘ └────────────┘
                             └───────────┘
   Provider registries (each provider = its own plugin, many instances allowed):
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ metadata     │ │ indexers     │ │ downloaders  │ │ subtitles    │ │ notifiers    │
   │ tmdb, tvdb,  │ │ torznab,     │ │ qbittorrent, │ │ opensubs,    │ │ discord,     │
   │ anidb, ...   │ │ newznab,     │ │ transmission,│ │ subdl, ...   │ │ webhook, ... │
   │              │ │ prowlarr,    │ │ sabnzbd, ... │ │              │ │              │
   │              │ │ cardigann    │ │              │ │              │ │              │
   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
   Orchestrators: search (RSS + manual + missing/upgrade sweeps), grab, download-monitor,
                  import, subtitle-manager
   Surfaces:      our own webui pages, REST API (/api/v1), *arr-compat API (/api/v3 shims)
```

### 3.1 Plugin contracts

Core defines registries; provider plugins register into them. When a provider plugin is
disposed, Cordis removes it from the registry automatically (registration goes through
`ctx.effect`), so a disabled indexer disappears from searches immediately.

```ts
interface MetadataProvider {
  id: string                       // 'tmdb', 'tvdb', 'anidb'
  kinds: MediaKind[]               // ['movie'] | ['series'] | both
  search(q: SearchQuery): Promise<MetadataSearchResult[]>
  getMovie?(externalId: string): Promise<MovieMetadata>
  getSeries?(externalId: string): Promise<SeriesMetadata>
  getEpisodes?(externalId: string, ordering?: EpisodeOrdering): Promise<EpisodeMetadata[]>
  orderings?(externalId: string): Promise<EpisodeOrdering[]>   // aired, dvd, absolute, TMDB episode groups
  mapIds?(ids: ExternalIds): Promise<ExternalIds>              // cross-reference imdb/tmdb/tvdb
}

interface IndexerProvider {
  id: string
  protocol: 'torrent' | 'usenet'
  capabilities(): Promise<IndexerCaps>            // categories, supported search params
  search(q: ReleaseQuery): Promise<ReleaseInfo[]> // by ids, title, season/episode
  rss?(): Promise<ReleaseInfo[]>
  test(): Promise<TestResult>
}

interface DownloadClient {
  id: string
  protocol: 'torrent' | 'usenet'
  add(release: ReleaseInfo, opts: AddOptions): Promise<DownloadRef>
  list(): Promise<DownloadStatus[]>               // polled by download-monitor
  remove(ref: DownloadRef, deleteData: boolean): Promise<void>
  outputPath(ref: DownloadRef): Promise<string>   // remote path; pathmap converts it
  test(): Promise<TestResult>
  // torrent-only extras are optional: seedRatio, seedTime, setCategory
}

interface SubtitleProvider {
  id: string
  search(q: SubtitleQuery): Promise<SubtitleCandidate[]>   // by hash, imdb id, name, language
  download(c: SubtitleCandidate): Promise<Buffer>
}

interface Notifier {
  id: string
  events: NotificationEvent[]
  send(e: NotificationEvent): Promise<void>
}
```

A provider plugin also declares a `schemastery` config schema; our settings pages render
its form with the `@cordisjs/components` schema form, and a "Test" button calls `test()`.

Because we don't ship `plugin-loader-webui`, our own **Settings → Integrations** pages
are the plugin manager for end users: adding an indexer/client/provider instance,
editing it, disabling it or removing it calls the `@cordisjs/plugin-loader` API
(add/update/remove entry in `cordarr.yml`), which hot-reloads that one plugin. Users
never see raw Cordis plugin names or YAML.

### 3.2 Events

Published on the Cordis event bus (and mirrored to the console over WebSocket):

`media/added`, `media/updated`, `media/deleted`, `release/grabbed`, `release/rejected`,
`download/added`, `download/progress`, `download/stalled`, `download/completed`,
`download/failed`, `import/completed`, `import/failed`, `file/upgraded`,
`file/deleted`, `subtitle/downloaded`, `health/changed`.

Events are for fan-out (UI, notifications, subtitle manager). **State transitions are not
driven by events alone**: they go through the jobs queue and are written to the DB so a
crash between steps doesn't lose work (see §5).

### 3.3 Two-level ID model

Each media item stores all known external IDs (`tmdb`, `tvdb`, `imdb`, `anidb`, `mal`)
plus a `primary_provider` field saying which provider owns its episode list. Movies
default to TMDB; series default to TVDB (Sonarr parity, and it's what most release names
and Prowlarr indexers key on), with TMDB selectable per series. Anime series can use
AniDB/absolute ordering. Scene/XEM mappings (TheXEM) translate between scene numbering
and the provider's numbering.

## 4. Data model (Drizzle, SQLite)

| Table | Key columns |
|---|---|
| `media_items` | id, kind (`movie`/`series`), title, sort_title, year, status, monitored, primary_provider, external_ids (JSON), root_folder_id, path, quality_profile_id, language_profile_id, subtitle_profile_id, series_type (`standard`/`daily`/`anime`), episode_ordering, tags, added_at, metadata_refreshed_at |
| `alternate_titles` | media_id, title, source, language (used by parser matching) |
| `seasons` | media_id, number, monitored |
| `episodes` | id, media_id, season, number, absolute_number, scene_season, scene_number, title, air_date_utc, monitored, has_file |
| `media_files` | id, media_id, path (relative), size, quality, resolution, source, video_codec, audio_codec, audio_channels, hdr, languages (JSON), release_group, edition, custom_format_score, mediainfo (JSON from ffprobe), original_release_name, added_at |
| `episode_files` | file_id, episode_id (many-to-many: multi-episode files) |
| `subtitle_files` | id, media_file_id, path, language, forced, hi, provider, score, synced |
| `quality_definitions` | quality, min/max/preferred size per minute |
| `quality_profiles` | name, ordered allowed qualities (JSON, supports groups), cutoff quality, min CF score, cutoff CF score, upgrades_allowed |
| `custom_formats` | name, specifications (JSON: regex on title, release group, source, resolution, language, size, indexer flags), include_in_rename |
| `profile_format_scores` | profile_id, format_id, score |
| `language_profiles` | name, languages, allow original language |
| `subtitle_profiles` | name, languages (+forced / HI flags), cutoff, min score |
| `release_restrictions` | required terms, ignored terms, tags |
| `root_folders` | path, kind, free-space warning threshold |
| `indexers` | id, plugin, name, config (JSON), enabled_rss, enabled_auto, enabled_interactive, priority, tags, source (`manual`/`prowlarr`/`cardigann`) |
| `indexer_status` | indexer_id, failures, disabled_until, last_rss_at, last_rss_guid |
| `download_clients` | id, plugin, name, config (JSON), priority, category, remove_completed, tags |
| `remote_path_mappings` | host, remote_path, local_path |
| `blocklist` | media_id, release title, indexer, info_hash, reason, created_at |
| `grabs` (download tracking) | id, media_id, episode_ids, release (JSON), indexer_id, client_id, download_id (hash/nzo id), state, state_changed_at, attempts, error |
| `history` | event type, media_id, episode_id, data (JSON), created_at |
| `jobs` | id, type, payload, run_at, attempts, status, lock_until, last_error |
| `settings` | key, value (JSON) — naming templates, media management options |
| `api_keys`, `users` | single admin user (argon2 hash), API keys |
| `notifications` | id, plugin, config, events |

Migrations: `drizzle-kit` generated SQL files checked in; applied on startup inside a
transaction, with an automatic DB backup before any migration.

## 5. Core flows

### 5.1 Grab/download state machine (persisted in `grabs.state`)

```
wanted ─search─▶ grabbed ─client accepted─▶ downloading ─complete─▶ import_pending
   ▲                │                          │   │                    │
   │           client rejected            stalled  failed          importing
   │                │                          │   │                 │      │
   └── blocklist + retry next best ◀───────────┴───┘            imported  import_failed
                                                                           (manual fix
                                                                            in UI queue)
```

- The **download monitor** polls every client (default 60s; disposable `ctx.setInterval`)
  and reconciles against `grabs`. It survives restarts because it re-reads `grabs`, not
  memory.
- **Stalled detection:** no progress for N minutes (configurable) or 0 seeds for M
  minutes → `download/stalled` → optional auto-fail.
- **Failed handling:** mark failed, add to blocklist, remove from client (optional), queue
  a search that excludes blocklisted releases.
- Downloads found in a client's category that we didn't grab (e.g. added manually) are
  shown in the queue as "unknown" and can be matched manually.

### 5.2 Search

- **RSS sync** (per indexer, default 15 min, respecting indexer caps): fetch feed, stop at
  the last seen GUID, parse each release, look up candidates in an in-memory index of
  wanted items keyed by normalized title + IDs (constant time per release), then run the
  decision engine.
- **Missing sweep / cutoff-unmet sweep:** scheduled jobs that search for a bounded batch
  of wanted items per run, oldest-searched first, to avoid hammering indexers.
- **Interactive search:** UI requests a search for an item; results stream back with
  every decision (accepted/rejected + reasons + score) visible.
- **Per-host rate limiting and backoff:** failures increase `indexer_status.disabled_until`
  exponentially; health check shows disabled indexers.

### 5.3 Decision engine

Evaluation order (each rejection records a reason shown in UI):
1. Parse release (see §6 Phase 2).
2. Match to media item/episodes (IDs from indexer first, then titles + alternate titles +
   scene mappings).
3. Hard filters: blocklist, quality allowed by profile, size within quality definition,
   required/ignored terms, language, minimum seeders, minimum age (usenet), minimum CF
   score, season pack vs. episode rules, already-grabbed-in-queue.
4. Score: quality rank, then custom format score, then protocol/indexer priority, then
   seeders/age/size as tie-breakers.
5. Upgrade check: accept only if better than the current file (quality rank, then CF
   score, then PROPER/REPACK of the same quality) and the current file hasn't reached the
   cutoff.

### 5.4 Import

1. Resolve the download's path through remote path mappings.
2. Find video files; skip samples, extras (configurable), and files below min size.
3. Match files to episodes (handles multi-episode files and season packs) or the movie.
4. ffprobe each file to confirm resolution/codecs/languages (release name can lie).
5. Re-run the upgrade check against what's on disk *now* (another import may have won).
6. Transfer: hardlink if same filesystem, else copy (torrents, so seeding continues) or
   move (usenet). Detect cross-device with `stat.dev`, fall back automatically.
7. Rename using templates; write to a temp name, then atomic `rename()` into place.
8. Replace old file: move it to the recycle bin folder (configurable) or delete.
9. Write DB changes in one transaction, emit `import/completed`, notify.
10. Import extra files (`.srt`, `.nfo`) alongside, if enabled.

Failures leave the grab in `import_failed` with a reason, visible in an "Activity → Needs
attention" list with a manual-import dialog.

### 5.5 Library scan / existing library import

- Point at an existing folder → walk it → parse folder and file names → look up metadata
  → show a review table (matched / ambiguous / unmatched) → import without moving files.
- Periodic rescan (default 12h) + on-demand: detects deleted/changed files, updates
  `has_file`, re-probes changed files.
- Optional filesystem watcher (chokidar) per root folder, disabled by default (unreliable
  on network shares).

## 6. Phases

Each phase ends with a runnable build and explicit exit criteria. Phase 3 is the MVP.

### Phase 1 — Foundations
- MIT `LICENSE`; root `package.json` (workspaces), `tsconfig.base.json`, project references, ESLint,
  Prettier, Vitest, `tsup`, GitHub Actions CI (lint, typecheck, test on Node 24).
- `packages/core`: app bootstrap with `@cordisjs/plugin-loader`, config dir resolution
  (`--config`, `CORDARR_CONFIG_DIR`), logger, the provider registries and service
  interfaces from §3.1, thin wrappers over Cordis APIs.
- `packages/db`: Drizzle schema (§4), migrations, backup-before-migrate, `ctx.db` service.
- `packages/jobs`: persisted job queue on the `jobs` table (retry with backoff, locking,
  scheduled/recurring jobs, visible in UI later).
- `packages/http-utils`: rate limiter + retry wrapper around `ctx.http`.
- **WebUI foundation** (see §10): `packages/webui-base` skeleton on `@cordisjs/client`
  with none of the stock pages loaded; one page, one schemastery-generated settings
  form, one widget updated live over WebSocket, and a plugin whose page disappears when
  it's disabled.

**Exit:** `npm run dev` boots, creates the DB, runs a scheduled test job, serves the
foundation page; CI green.

### Phase 2 — Release parser & decision engine (pure logic, heavily tested)
- `packages/parser`: title, year, season/episode (incl. `S01E01E02`, `1x01`, daily
  `2024.05.01`, anime absolute `- 123`, season packs, multi-season), resolution, source,
  modifiers (Remux, PROPER, REPACK, REAL), video codec, HDR formats, audio codec/channels,
  languages, edition, release group, hash-tagged anime groups `[Group]`.
- Golden fixture file: ≥500 real release names with expected output, collected from
  indexer RSS feeds and our own libraries. The project is MIT, so no code or test files
  are copied from the GPL-3.0 *arr projects (see §10).
- `packages/decision`: quality definitions, profiles, custom formats, scoring, upgrade
  decider, with rejection reasons.

**Exit:** parser fixtures pass; decision engine unit tests cover every rule in §5.3.

### Phase 3 — MVP: movies end-to-end
- `plugins/metadata-tmdb`: search, movie details, images, IMDb mapping.
- `plugins/indexer-torznab` and `plugins/indexer-newznab` (shared XML parser + caps).
- `plugins/downloader-qbittorrent` (Web API v2, categories, auth, tags).
- `plugins/downloader-transmission` (RPC API, `X-Transmission-Session-Id` handshake,
  labels as categories, `downloadDir`). Second client, built right after qBittorrent so
  the `DownloadClient` interface is proven against two implementations before TV work.
- `packages/pathmap`: remote path mappings.
- `packages/library`: media items, root folders, naming templates, movie import (§5.4).
- `packages/orchestrator`: RSS sync, missing search, grab, download monitor, import
  (§5.1–5.4) for movies.
- `packages/api`: REST `/api/v1` (movies, queue, history, indexers, clients, profiles),
  API key auth.
- `packages/webui-base`: our console shell built on `@cordisjs/client` (sidebar,
  header status, notifications toast, global search, the page/widget/slot registration
  helpers that feature plugins use), login page, and pages: Movies (grid/list), Movie detail (files,
  interactive search, history), Activity (queue/history), Settings (profiles, root
  folders, naming, indexers, download clients — forms rendered from schemas).

**Exit:** add a movie in the UI → it's found on a Torznab indexer → sent to qBittorrent
or Transmission (in Docker, with a path mapping) → imported by hardlink with the right
name → shown as downloaded. Upgrade path works when a better release appears in RSS.

### Phase 4 — TV
- `plugins/metadata-tvdb` (v4 API, needs a subscriber PIN or project key — see §9) and
  TV support in `metadata-tmdb` (seasons, episodes, episode groups for alternate
  orderings).
- `plugins/mapping-xem`: scene numbering.
- Series/season/episode monitoring options (all, future, missing, first season, latest
  season, none), series types (standard/daily/anime).
- Episode matching, season packs, multi-episode files, specials (season 0).
- Calendar page + iCal feed.
- Pages: Series list, Series detail (season tables with per-episode status/actions).

**Exit:** a standard, a daily and an anime series each go from add → import correctly,
including a season pack.

### Phase 5 — Migration & library scan
- Library scan / existing folder import (§5.5).
- `packages/migrate-arr`: read Radarr/Sonarr SQLite DBs (read-only) and import media,
  files, profiles, custom formats, indexers, download clients, tags, history (last N
  months). Dry-run report first.
- Import from Radarr/Sonarr **API** as an alternative when the DB file isn't accessible.
- TRaSH Guides import for custom formats/quality profiles (JSON from their repo).

**Exit:** a real Radarr + Sonarr instance migrates with a report showing zero
unexplained mismatches.

### Phase 6 — Prowlarr support (two tracks)
**6a. Use an existing Prowlarr (first):**
- `plugins/indexer-prowlarr`: connects with Prowlarr URL + API key, lists its indexers
  (`/api/v1/indexer`), and creates one Torznab/Newznab indexer per Prowlarr indexer
  using Prowlarr's per-indexer proxy URLs (`/{id}/api`), kept in sync on a timer.
  Indexers created this way have `source = 'prowlarr'` and are read-only in our UI.
- *arr-compat API shim (`/api/v3/system/status`, `/api/v3/indexer`, `/api/v3/indexer/schema`,
  `/api/v3/indexer/test`) so Prowlarr can instead **push** indexers to us by adding us as
  a "Radarr" and/or "Sonarr" application. Contract tests pin the exact payloads Prowlarr
  sends.

**6b. Replace Prowlarr (later):**
- `plugins/indexer-cardigann`: run Cardigann YAML indexer definitions (the format Jackett
  and Prowlarr use): login flows (form, cookie, API key), search paths, CSS/JSON selectors,
  filters, category mapping. Definitions fetched from the Prowlarr indexer definitions
  repo with a version check, cached on disk.
- Cloudflare-protected sites via an optional FlareSolverr proxy setting.
- Indexer stats page (queries, grabs, failures, response times) — our own page, not
  `plugin-http-webui`.
- Expose our indexers as Torznab endpoints so other apps can use us like Prowlarr.

**Exit (6a):** indexers from an existing Prowlarr appear and search works, both via pull
and via Prowlarr's app sync. **Exit (6b):** the 20 most-used public trackers' Cardigann
definitions pass a live smoke test.

### Phase 7 — Subtitles (Bazarr replacement)
- `packages/subtitles`: subtitle profiles (languages, forced, hearing-impaired, cutoff),
  detection of embedded tracks (ffprobe) and external `.srt/.ass` files, "wanted"
  computation per file.
- Triggers: on `import/completed`, scheduled wanted sweep, and upgrade sweep (replace a
  low-score subtitle with a better one, within a time window).
- Matching and scoring: file hash (OpenSubtitles hash) > release name/group > title +
  year/episode; score threshold per profile.
- Post-processing: encoding normalization to UTF-8, optional sync via an external
  `alass` / `ffsubsync` binary if present, naming `Movie.en.forced.srt`.
- Provider plugins: `subtitles-opensubtitles` (opensubtitles.com REST API), then
  `subtitles-subdl`, `subtitles-podnapisi`, `subtitles-addic7ed` (TV), with per-provider
  throttling and daily quota tracking.
- UI: Subtitles tab on movie/episode detail (have/wanted/search manually), Wanted
  subtitles page, provider settings.
- Migrate from Bazarr: subtitle profiles and provider configs from its DB.

**Exit:** new imports get subtitles in the profile's languages automatically; manual
search and replace works from the UI.

### Phase 8 — More providers & integrations
- Download clients: Deluge, SABnzbd, NZBGet (usenet: no seeding, `nzo_id`
  refs, post-processing status handling).
- Notifiers: Discord, Telegram, ntfy, generic webhook, email; media server refresh
  (Plex, Jellyfin, Emby) on import.
- Overseerr/Jellyseerr compatibility: extend the `/api/v3` shim with movie/series
  add/lookup, quality profile and root folder listing, as used by those apps.
- Import lists: TMDB lists, Trakt, IMDb lists, Plex watchlist.
- Metadata: `metadata-anidb` for anime.

### Phase 9 — Hardening & release
- Health checks page: indexer/client reachability, root folder free space and
  permissions, path mapping sanity (compare client-reported path vs visible path),
  failed jobs, DB integrity.
- Backups: scheduled zipped DB + config backups with retention; restore from UI.
- Performance: test with 5,000 movies / 1,000 series / 100k episodes; paginate/virtualize
  UI lists; DB indices on hot queries.
- Security review: API key handling, CSRF/origin checks on WebSocket, secrets redacted in
  logs and exported configs, SSRF considerations for user-supplied URLs.
- Docs site, Docker image, first tagged release.

## 7. Cross-cutting requirements (the gap list)

| Requirement | Where |
|---|---|
| Persisted state machine for downloads | §5.1, Phase 3 |
| Failed/stalled handling, blocklist, auto-retry | §5.1, Phase 3 |
| Remote path mappings (Docker) | Phase 3 `pathmap`, health check in Phase 9 |
| Hardlink → copy/move fallback across filesystems | §5.4 step 6 |
| Existing library scan & *arr migration | Phase 5 |
| Season packs, multi-episode, specials, daily, anime | Phase 2 parser, Phase 4 |
| PROPER/REPACK, language, size limits, required/ignored terms | §5.3, Phase 2 |
| Custom formats + TRaSH import | Phase 2, Phase 5 |
| Persistent job scheduler | Phase 1 `jobs` |
| Per-indexer rate limits, backoff, auto-disable | §5.2, Phase 1 `http-utils` |
| Auth (admin login + API keys), WebSocket origin check | Phase 3, Phase 9 |
| Notifications & media-server refresh | Phase 8 |
| Recycle bin for replaced/deleted files | §5.4 step 8 |
| Backups & restore | Phase 1 (pre-migration), Phase 9 (scheduled) |
| Health checks | Phase 9 (individual checks added as each feature lands) |
| Calendar + iCal | Phase 4 |
| Import lists | Phase 8 |
| Subtitles | Phase 7 |
| Prowlarr use + replacement | Phase 6 |
| TMDB + TVDB + others as plugins | §3.1, §3.3, Phases 3/4/8 |
| Docker, PUID/PGID, config dir layout | §8 |

## 8. Distribution & configuration

- **Docker image** (primary): `node:24-slim` base + `ffprobe`, runs as `PUID/PGID`,
  `UMASK` respected for created files, volumes `/config` and media paths, healthcheck
  endpoint `/api/v1/health`.
- **Config dir layout:**
  ```
  /config
    cordarr.yml        # cordis loader config: which plugins, their settings
    cordarr.db         # SQLite (WAL mode)
    backups/
    logs/
    cache/             # images, cardigann definitions
    plugins/           # user-installed plugins (via plugin-market)
  ```
- Secrets (API keys) can come from env vars referenced in `cordarr.yml`
  (`${TMDB_API_KEY}`); never logged.
- Bare-metal: `npx cordarr` with the same layout under the OS data dir.

## 9. Testing strategy

- **Parser:** golden fixtures (Phase 2), run on every PR.
- **Decision engine:** table-driven unit tests per rule.
- **Providers:** recorded HTTP fixtures with `msw`; one opt-in live test per provider
  (skipped in CI unless secrets exist).
- **Orchestrator:** integration tests with a temp SQLite DB, fake indexer (Torznab XML
  server), fake download client, and a temp filesystem — covering restart in every
  state of §5.1.
- **Import:** tests for hardlink, cross-device fallback (a tmpfs mount in CI), atomic
  replacement, permission errors.
- **Compatibility:** contract tests for the `/api/v3` shim against payloads captured from
  real Prowlarr/Overseerr.
- **UI:** Playwright smoke test of the Phase 3 exit flow against the fake services.
- **End-to-end (manual, per release):** docker-compose with real qBittorrent + Prowlarr.

## 10. Risks & constraints

| Risk | Mitigation |
|---|---|
| Cordis v4 is an RC; APIs may change | Pin exact versions; wrap Cordis APIs in `core`; upgrade deliberately |
| Cordis WebUI is Koishi-oriented and lightly documented | Build the foundation in Phase 1 before any feature pages. Where `@cordisjs/client` lacks something, add it in `webui-base` or contribute upstream; no standalone-Vue fallback |
| Licensing: project is MIT; Radarr/Sonarr/Prowlarr/Bazarr are GPL-3.0 | Clean-room only: implement from public API docs and observed behavior, never copy their code or test files. Cardigann definitions are downloaded at runtime as data (not vendored into the repo), so their license doesn't attach to ours. Check each dependency's license in CI (`license-checker` allowlist) |
| TVDB v4 API requires a paid project key or user subscriber PIN | Make TVDB optional; TMDB works out of the box; user supplies their PIN |
| TMDB TV numbering differs from scene/TVDB | Per-series primary provider + episode groups + XEM |
| Indexer sites break or block | Cardigann definitions updated from upstream; FlareSolverr support; Prowlarr passthrough stays supported |
| Scope is large (four mature apps) | Phase 3 MVP first; each later phase is independently shippable |
| `better-sqlite3` native builds on ARM/Alpine | Prebuilt binaries on `node:24-slim`; driver adapter allows `node:sqlite` later |

## 11. Decisions

| Decision | Choice |
|---|---|
| License | MIT (clean-room; see §10) |
| Download clients | qBittorrent first, Transmission second (both in the MVP) |
| UI | Cordis WebUI core packages only; all pages are ours; no stock pages, no standalone fallback |
| Metadata | TMDB + TVDB (+ AniDB later), each a plugin |
| Prowlarr | Use existing Prowlarr first, native replacement later (Phase 6) |
| Subtitles | Built in (Phase 7) |

Still open (not blocking Phase 1):
1. **Final name** (placeholder `cordarr`).
2. **Database layer:** Drizzle (current plan) vs the Cordis ecosystem's own
   `minato` / `@cordisjs/plugin-database` + `@minatojs/driver-sqlite`, which lets plugins
   extend tables with `ctx.model.extend()` and ties table lifetime to plugin lifetime.
