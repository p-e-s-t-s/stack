# Implementation Plan: Unified Media Manager

A single-process replacement for Radarr, Sonarr and Bazarr (and later Lidarr, Readarr and a
podcast manager) that works with Prowlarr for indexers, built on the
[Cordis](https://github.com/cordiverse/cordis) plugin kernel with a Cordis WebUI console
that plugins extend with their own pages, widgets and actions.

> **Name:** Magpie (npm scope `@magpiejs/*`; the `@magpie` scope is already taken).

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
| `@cordisjs/plugin-include` | `1.1.x` | Loads a YAML file (`magpie.yml`) into the loader and writes UI changes back to it. |
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
- Because Cordis v4 is an RC, `packages/app` wraps the few Cordis APIs we lean on so a
  breaking RC bump is fixed in one place. Renovate PRs for `cordis` / `@cordisjs/*` are
  manual-merge only.
- **Node:** the plan targets Node 24 LTS (the dev container currently has Node 22; CI
  and Docker pin 24).

## 1. Goals and non-goals

**Goals**
- One process, one SQLite file, one web UI for movies, TV, indexers and subtitles, and then
  podcasts, books (ebooks and audiobooks) and music.
- Every integration (metadata source, indexer, download client, subtitle provider,
  notifier) is a Cordis plugin that can be enabled, reconfigured or removed at runtime
  without restarting.
- Drop-in migration from an existing Radarr/Sonarr/Bazarr setup, including an
  existing library on disk.
- Compatible enough with the Radarr/Sonarr v3 API that Prowlarr sync and
  Overseerr/Jellyseerr work unchanged.

**Non-goals (v1)**
- Playing, streaming or hosting media (podcasts included): Magpie fetches and organizes.
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
| DB | SQLite + Drizzle ORM for schema and queries, with our own Cordis plugin layer `@magpiejs/database` (§4.2) that gives each plugin its own tables, versioned migrations and real foreign keys, tied to the plugin lifecycle. Driver: `better-sqlite3` (decided in Phase 1, §4.2) |
| Config schemas | `schemastery` |
| Tests | Vitest; `msw` for HTTP mocks; Playwright for a few UI smoke tests |
| Media probing | `ffprobe` (bundled in Docker image) |
| Lint/format | ESLint (flat config) + Prettier |
| License | MIT |

## 3. Architecture

Magpie follows the Cordis model all the way down: **every feature is a plugin that brings
its own services, data model, jobs, HTTP routes and UI pages**, and disposing it removes
all of them. There is no central "core" that owns the schema. The only non-plugin packages
are the entry point (`app`), shared types, and pure-logic libraries (`parser`,
`http-utils`).

```
                          ┌───────────────────────────────────────┐
                          │ cordis + loader (magpie.yml) + hmr    │
                          └───────────────────┬───────────────────┘
 Infrastructure services (each a plugin providing a ctx service)
   database (ctx.database) · jobs (ctx.jobs) · auth · api (ctx.api) · webui-base
                                              │
 Feature plugins (each owns its own tables + pages + jobs; never alters another's)
   library ── movies ── series ── decision ── indexers ── downloads ── import
   history ── notify ── subtitles ── calendar ── migrate-arr ── compat-api
                                              │
 Provider plugins (register into a feature's registry; many instances allowed)
   metadata: tmdb, tvdb, anidb, xem          indexers: torznab, newznab, prowlarr      
   downloads: qbittorrent, transmission, …   subtitles: opensubtitles, subdl, …
   notify: discord, webhook, ntfy, …
```

### 3.0 Plugins and what they own

| Plugin | Provides | Owns (tables / fields it declares) | Depends on |
|---|---|---|---|
| `@magpiejs/database` | `ctx.database`: per-plugin schema registration, migration runner, backups (§4.2) | `_magpie_migrations` | — |
| `@magpiejs/jobs` | `ctx.jobs` persisted queue & schedules | `jobs` | database |
| `@magpiejs/auth` | login, API keys, WS origin check | `users`, `api_keys` | database, server |
| `@magpiejs/api` | `ctx.api` REST route helper under `/api/v1` | — | server, auth |
| `@magpiejs/webui-base` | shell, `page`/`widget`/`slot` helpers | — | webui |
| `@magpiejs/library` | `ctx.library`: media items, files, root folders, naming | `media_items`, `media_files`, `alternate_titles`, `root_folders`, `naming` | database |
| `@magpiejs/movies` | movie kind, movie pages | `movie_details` (media_id → `media_items`) | library |
| `@magpiejs/series` | series kind, series pages | `series_details` (media_id → `media_items`), `seasons`, `episodes`, `episode_files` | library |
| `@magpiejs/decision` | `ctx.decision`: profiles, custom formats, scoring | `quality_sizes`, `profiles`, `custom_formats`, `profile_scores`, `restrictions` (see [phase-2.md](phase-2.md#32-tables)) | database |
| `@magpiejs/indexers` | `ctx.indexers` registry, RSS sync, search | `indexer_status` | decision, jobs |
| `@magpiejs/downloads` | `ctx.downloads` registry, grab, monitor, path mapping | `grabs`, `blocklist`, `remote_path_mappings` | indexers, jobs |
| `@magpiejs/import` | import pipeline, library scan | — (writes via `ctx.library`) | library, downloads |
| `@magpiejs/history` | activity log | `history` | database |
| `@magpiejs/notify` | `ctx.notify` registry | — | — |
| `@magpiejs/subtitles` | `ctx.subtitles` registry, wanted/upgrade logic | `subtitle_profiles`, `subtitle_assignments` (media_id → `media_items`), `subtitle_files` (media_file_id → `media_files`) | library, jobs |
| `@magpiejs/calendar` | calendar page + iCal; `ctx.calendar` sources (Phase 4.5) | — | — |
| `@magpiejs/podcasts` | podcast kind, feeds, retention, pages (Phase 4.6) | `podcasts_details`, `podcasts_episodes`, `podcasts_episode_files` | library, downloads |
| `@magpiejs/downloader-http` | direct downloads over HTTP (`http` protocol) (Phase 4.6) | — | downloads, http |
| `@magpiejs/books` | book kind: authors, books, ebook + audiobook families, pages (Phase 4.7) | `books_authors`, `books_books`, `books_book_files`, `books_grab_books` | library, decision |
| `@magpiejs/music` | music kind: artists, albums, tracks, audio family, pages (Phase 4.8) | `music_artists`, `music_albums`, `music_tracks`, `music_track_files`, `music_grab_albums` | library, decision |
| `@magpiejs/compat-api` | `/api/v3` shims for Prowlarr/Overseerr | — | api, library |

What this buys:
- **Disable TV and nothing else notices.** Turning off `series` removes its pages, routes,
  jobs and matching logic; movies keep working; the series tables stay on disk and come
  back when it's re-enabled.
- **Subtitles is optional in the true sense.** It never touches library tables; without
  it there are no subtitle tables in use and no subtitle UI.
- **Third-party plugins get first-class storage** the same way first-party ones do.
- **Instance config lives in `magpie.yml`, runtime state lives in the DB.** An indexer's
  URL/API key is its loader entry's config; its failure count is a row in
  `indexer_status` keyed by that entry's id. There is no second copy of config in SQL.

### 3.0.1 Table ownership rule

**A plugin only creates and changes its own tables.** To attach data to something another
plugin owns, it creates its own table that references the other table's id:

- one-to-one extra fields → a side table keyed by the owner's id
  (`subtitle_assignments(media_id PK, subtitle_profile_id)`, `series_details(media_id PK,
  series_type, episode_ordering, …)`);
- one-to-many → a child table with the reference column
  (`subtitle_files(media_file_id, …)`).

Why: a plugin's schema changes can't break another plugin, removing a plugin removes
exactly its tables, and each table has one owner responsible for its migrations.

Table names are prefixed with the owning plugin's namespace (`library_media_items`,
`subtitles_assignments`, …) so ownership is visible in the database itself. The rule is
enforced in CI: a plugin's schema may only define tables with its prefix, and its
migration SQL may only create, alter or drop those tables.

**References are real SQLite foreign keys**, declared in the referencing plugin's Drizzle
schema against the owner's exported table (`references(() => library.mediaItems.id,
{ onDelete: 'cascade' })`):

- **Deletes cascade in the database**, so they work even while the referencing plugin is
  disabled. Each reference picks `cascade`, `set null` or `restrict` deliberately.
- **Load order is guaranteed by Cordis:** a plugin with a foreign key into another
  plugin's table must `inject` that plugin's service, so the owner's migrations have run
  before its own.
- **An owner's table rebuild doesn't break references:** the migration runner turns
  foreign key checks off around each migration and runs `PRAGMA foreign_key_check` before
  committing (the procedure SQLite's docs prescribe). Verified on Node 22's
  `node:sqlite`: child rows survive a parent-table rebuild, and a later parent delete
  still cascades.
- **Reads:** the owner exports its Drizzle table objects (`@magpiejs/library/schema`) so
  others can join against them read-only; writes go through the owner's service
  (`ctx.library.update(...)`).

### 3.1 Plugin contracts

Feature plugins define registries; provider plugins register into them. When a provider plugin is
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
(add/update/remove entry in `magpie.yml`), which hot-reloads that one plugin. Users
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

## 4. Data model (SQLite)

### 4.1 Tables

The owning plugin for each table is listed in §3.0. Names below omit the plugin prefix.

| Table | Key columns |
|---|---|
| `media_items` | id, kind (`movie`/`series`), title, sort_title, year, status, monitored, primary_provider, external_ids (JSON), root_folder_id, path, quality_profile_id, language_profile_id, tags, added_at, metadata_refreshed_at |
| `movie_details` | media_id, edition, collection_id, digital/physical release dates |
| `series_details` | media_id, series_type (`standard`/`daily`/`anime`), episode_ordering, network, air time |
| `alternate_titles` | media_id, title, source, language (used by parser matching) |
| `seasons` | media_id, number, monitored |
| `episodes` | id, media_id, season, number, absolute_number, scene_season, scene_number, title, air_date_utc, monitored, has_file |
| `media_files` | id, media_id, path (relative), size, quality, resolution, source, video_codec, audio_codec, audio_channels, hdr, languages (JSON), release_group, edition, custom_format_score, mediainfo (JSON from ffprobe), original_release_name, added_at |
| `episode_files` | file_id, episode_id (many-to-many: multi-episode files) |
| `subtitle_assignments` | media_id, subtitle_profile_id |
| `subtitle_files` | id, media_file_id, path, language, forced, hi, provider, score, synced |
| `quality_sizes` | quality, min/max/preferred size per minute |
| `profiles` | name, ordered allowed qualities (JSON, supports groups), cutoff quality, min/cutoff format score, upgrades allowed, languages, min seeders, min age |
| `custom_formats` | name, conditions (JSON: regex on title, release group, source, resolution, language, size, indexer flags), include in file name |
| `profile_scores` | profile_id, format_id, score |
| `subtitle_profiles` | name, languages (+forced / HI flags), cutoff, min score |
| `restrictions` | required terms, ignored terms, tags |
| `root_folders` | path, kind, free-space warning threshold |
| `indexer_status` | indexer_id (loader entry id), failures, disabled_until, last_rss_at, last_rss_guid |
| `remote_path_mappings` | host, remote_path, local_path |
| `blocklist` | media_id, release title, indexer, info_hash, reason, created_at |
| `grabs` (download tracking) | id, media_id, episode_ids, release (JSON), indexer_id, client_id, download_id (hash/nzo id), state, state_changed_at, attempts, error |
| `history` | event type, media_id, episode_id, data (JSON), created_at |
| `jobs` | id, type, payload, run_at, attempts, status, lock_until, last_error |
| `naming` | naming templates, media management options (row per kind) |
| `api_keys`, `users` | single admin user (argon2 hash), API keys |

Indexer, download client, notifier and provider *instances* are loader entries in
`magpie.yml` (their config schema is the plugin's `schemastery` schema), not tables.

### 4.2 `@magpiejs/database`: our plugin schema layer

Drizzle builds the SQL and the types; this layer adds what Cordis needs. It's a small
package (a few hundred lines plus tests), not an ORM.

**Plugin API**

```ts
// in plugins/subtitles
export const inject = ['database', 'library']

export function apply(ctx: Context) {
  const db = ctx.database.register({
    namespace: 'subtitles',                               // table prefix
    schema,                                               // Drizzle sqliteTable objects
    migrations: new URL('../migrations', import.meta.url) // drizzle-kit output
  })
  // db: typed Drizzle instance for this plugin's schema (+ owners' exported tables for reads)
}
```

`register()` runs inside the plugin's lifecycle (`ctx.effect`): when the plugin is
disposed its schema is unregistered; its tables and data stay.

**Migrations**

- Each plugin package has its own `drizzle.config.ts` and `migrations/` folder, generated
  with `drizzle-kit generate` and reviewed in PRs like any other code.
- When a plugin starts, the runner compares its migration journal with
  `_magpie_migrations(namespace, tag, hash, applied_at)` and:
  - refuses to start the plugin if an applied migration's file hash changed (edited
    after release) or if the DB has migrations the plugin doesn't know (downgrade);
  - otherwise takes a `VACUUM INTO` backup when anything is pending, then applies all
    pending migrations in **one transaction**, with foreign key checks off and
    `PRAGMA foreign_key_check` before commit. Any error rolls back everything and the
    plugin fails to start (shown in the UI); other plugins keep running.
- Migrations from different plugins are serialized with a lock, since Cordis can start
  plugins concurrently.
- Data migrations are ordinary SQL (or a TS step registered for a tag), inside the same
  transaction.
- Nothing is auto-synced from the schema at runtime: the checked-in migration files are
  the only way the schema changes.

**Removing a plugin's data** is an explicit "Delete data" action in Settings →
Integrations: it drops the plugin's prefixed tables and its `_magpie_migrations` rows,
after a backup. It never happens automatically on disable or uninstall.

**Connection settings:** `journal_mode=WAL`, `busy_timeout`, `foreign_keys=ON`,
scheduled `VACUUM INTO` backups with retention.

**Driver (decided in Phase 1): `better-sqlite3`.** It installs from prebuilt binaries,
and its Drizzle driver runs transactions synchronously, so no other plugin's query can
slip into an open migration transaction. Drizzle's `node:sqlite` driver only exists in the
Drizzle 1.0 release candidate; revisit once 1.0 is stable. The layer hides the choice from
plugins.

Reloading the database plugin itself restarts every plugin that depends on it (that's how
Cordis dependencies work); the UI labels database settings accordingly.

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

### Phase 1 — Foundations (done)
- MIT `LICENSE`; npm workspaces, TypeScript 6 (typescript-eslint doesn't support 7 yet),
  ESLint, Prettier, Vitest, GitHub Actions CI (typecheck, lint, format, ownership check,
  tests, production build on Node 24). Packages run from TypeScript source through `tsx`;
  publishing builds come later.
- `packages/app`: boots Cordis with `@cordisjs/plugin-loader` and
  `@cordisjs/plugin-include` (`magpie.yml`, written with defaults on first start), config
  dir from `--config` / `MAGPIE_CONFIG_DIR`, console output from Cordis 4's built-in
  logger, clean shutdown on SIGINT/SIGTERM.
- `packages/types`, `packages/http-utils` (token-bucket rate limiter, retry with backoff).
- `plugins/database`: the §4.2 layer, including the crash test.
- `plugins/jobs`: persisted queue with retries, dedupe keys and schedules, bound to the
  defining plugin's lifecycle.
- `plugins/webui`: subclass of `@cordisjs/plugin-webui` that serves Magpie's own shell
  (sidebar, home page with a `home-widgets` slot) instead of the stock console; dev mode
  runs Vite, `npm run build` produces the shell plus each plugin's client entry.
- `plugins/system`: the foundation page — live job-queue widget, a test job button,
  database namespaces, and a schemastery-generated form that edits the jobs plugin's
  settings at runtime through the loader.

What Phase 1 found out (differs from the original plan):
- `@cordisjs/plugin-logger` 1.0.x predates Cordis 4's built-in logger and prints nothing;
  the app attaches a console exporter to the built-in logger instead.
- `@cordisjs/plugin-hmr` hangs outside Cordis's own CLI worker; dev restarts come from
  `tsx watch` instead.
- `@cordisjs/client` defaults to the `zh-CN` locale; the shell follows the browser.
- The web console builds with Vite 7 (what `@cordisjs/client` uses); Vitest uses Vite 8.

### Phase 2 — Release parser & decision engine (pure logic, heavily tested)

Detailed plan: [phase-2.md](phase-2.md).

- `packages/parser`: release name → structured fields (title, year, episodes incl. daily,
  anime and packs, resolution, source, modifiers, codecs, HDR, audio, languages, edition,
  streaming service, revision, group), with the source text of every field.
- Fixtures: hand-written cases plus ≥500 reviewed real names collected by a script from
  your own *arr history or indexer feeds. No code or tests copied from GPL-3.0 projects.
- `plugins/decision`: qualities, size limits, profiles, custom formats, rules (extensible
  by other plugins), upgrade/cutoff logic and ranking.
- Web console: Parse tester, and editors for profiles, custom formats and sizes.

**Exit:** ≥500 reviewed fixtures pass; 10k names parse in under a second; every rule has
unit tests; the new pages work in the production build.

### Phase 3 — MVP: movies end-to-end

Detailed plan: [phase-3.md](phase-3.md).

- `plugins/metadata-tmdb`: search, movie details, images, IMDb mapping.
- `plugins/indexer-torznab` and `plugins/indexer-newznab` (shared XML parser + caps).
- `plugins/downloader-qbittorrent` (Web API v2, categories, auth, tags).
- `plugins/downloader-transmission` (RPC API, `X-Transmission-Session-Id` handshake,
  labels as categories, `downloadDir`). Second client, built right after qBittorrent so
  the `DownloadClient` interface is proven against two implementations before TV work.
- `plugins/library`, `plugins/movies`, `plugins/decision`, `plugins/indexers` (RSS sync,
  missing search), `plugins/downloads` (grab, monitor, path mapping), `plugins/import`,
  `plugins/history` (§5.1–5.4) for movies.
- `plugins/auth`, `plugins/api`: REST `/api/v1` (movies, queue, history, indexers, clients, profiles),
  API key auth.
- `plugins/webui-base`: our console shell built on `@cordisjs/client` (sidebar,
  header status, notifications toast, global search, the page/widget/slot registration
  helpers that feature plugins use), login page, and pages: Movies (grid/list), Movie detail (files,
  interactive search, history), Activity (queue/history), Settings (profiles, root
  folders, naming, indexers, download clients — forms rendered from schemas).

**Exit:** add a movie in the UI → it's found on a Torznab indexer → sent to qBittorrent
or Transmission (in Docker, with a path mapping) → imported by hardlink with the right
name → shown as downloaded. Upgrade path works when a better release appears in RSS.

### Phase 4 — TV (done)

Detailed in [phase-4.md](phase-4.md). Delivered: TV in `metadata-tmdb`, the `series` plugin
(monitoring options, standard/daily/anime types, specials), episode and season-pack search,
grabbing and import (multi-episode files), automation, and the `calendar` plugin (page +
iCal feed). Moved to Phase 8: `metadata-tvdb` (needs a paid subscriber PIN), `mapping-xem`
scene numbering, and TMDB episode groups for alternate orderings.

**Exit (met, with fake services):** a standard, a daily and an anime series each go from
search → import correctly, including a season pack.

### Phase 4.5 — Generic media kinds (done)

Detailed in [phase-4.5.md](phase-4.5.md). Makes a new kind of media a new plugin, with no
edits to core plugins: open `MediaKind`; **quality families** (video built in) with their own
parser, size rule and default profiles, and profiles per family; indexer **search types**
and Torznab categories per kind; naming templates per kind; import by file extension;
calendar sources; an `http` download protocol.

**Exit (met):** existing tests and data upgrade unchanged, and a fixture kind defined in a
test (`packages/app/tests/fixture-kind.test.ts`) goes search → grab → import → calendar
without touching core plugins.

### Phase 4.6 — Podcasts

- `metadata-itunes`: podcast search (no key needed). Feeds (RSS 2.0, iTunes and
  `podcast:` namespaces) are read by the podcasts plugin itself.
- `downloader-http`: a download client for direct URLs (resume, progress, retries), used
  through the normal downloads queue with the `http` protocol.
- `podcasts`: add by search or feed URL, OPML import/export; per podcast: download all,
  new episodes only, or the last N; keep the last N and delete older ones (optional);
  feed refresh every hour. No indexers or quality profiles: each episode has one file.
- Naming `{Podcast Title}/{Published Date} - {Episode Title}`; Podcasts pages; calendar
  source (new episodes).

**Exit:** a podcast added by search and one added by feed URL download new episodes on
refresh, and retention keeps only the last N.

### Phase 4.7 — Books (ebooks and audiobooks)

- `metadata-openlibrary`: authors, works, editions, ISBNs, covers (no key); optional
  `metadata-googlebooks`.
- `books`: authors are library items and books are their units (like series and episodes);
  monitor all, future or selected books; ebooks and audiobooks are tracked separately per
  book, each with its own root folder and profile.
- Quality families `ebook` (EPUB, AZW3, MOBI, PDF, CBZ/CBR) and `audiobook` (M4B, MP3,
  FLAC); a book release parser (`Author - Title (Year) [EPUB]`, `Title by Author`, retail
  tags, narrators) with golden fixtures.
- Search type `t=book` (author, title), categories 7000/7020 (ebooks) and 3030
  (audiobooks). Import keeps multi-file audiobooks together as one folder.
- Pages: Authors, Author detail, Add; calendar source (release dates).

**Exit:** add an author, and a wanted book is found by a fake Newznab book search, then
imported as an ebook and as an audiobook into their own folders with the right names.

### Phase 4.8 — Music

- `metadata-musicbrainz`: artists, release groups, releases, track lists (1 request per
  second), covers from the Cover Art Archive.
- `music`: artists are library items and albums are their units, with tracks per album.
  Monitoring: all, future or selected albums, filtered by type (album, EP, single, live,
  compilation), like Lidarr's metadata profiles.
- Quality family `audio` (MP3 128–320, V0/V2, AAC, Opus/Vorbis, FLAC 16-bit and 24-bit,
  ALAC, WAV) with size per minute of album length; a music release parser
  (`Artist - Album (2020) [FLAC 24-96] [WEB]`) and a track file-name parser, with golden
  fixtures.
- Search type `t=music` (artist, album), categories 3000/3010/3040. Import matches files to
  the track list by disc, track number, title and duration, refuses albums that don't
  match, handles multi-disc releases, and names
  `{Artist}/{Album} ({Year})/{Disc}{Track:00} - {Title}`. Writing tags is optional.
- Pages: Artists, Artist detail (albums by type), Album detail (tracks), Add; calendar
  source (album releases).

**Exit:** add an artist; a wanted album is found, and a FLAC release is imported with
correct per-track names; a later FLAC 24-bit release replaces an MP3 album as an upgrade.

### Phase 5 — Migration & library scan
- Library scan / existing folder import (§5.5).
- `plugins/migrate-arr`: read Radarr/Sonarr SQLite DBs (read-only) and import media,
  files, profiles, custom formats, indexers, download clients, tags, history (last N
  months). Dry-run report first.
- Import from Radarr/Sonarr **API** as an alternative when the DB file isn't accessible.
- TRaSH Guides import for custom formats/quality profiles (JSON from their repo).

**Exit:** a real Radarr + Sonarr instance migrates with a report showing zero
unexplained mismatches.

### Phase 6 — Prowlarr integration

Magpie doesn't replace Prowlarr; it uses it. Indexers work from Phase 3 by pasting
Prowlarr's per-indexer Torznab/Newznab URLs; this phase removes that manual step.

- `plugins/indexer-prowlarr`: connects with Prowlarr URL + API key, lists its indexers
  (`/api/v1/indexer`), and registers one Torznab/Newznab indexer per Prowlarr indexer
  into `ctx.indexers` using Prowlarr's per-indexer proxy URLs (`/{id}/api`), kept in sync
  on a timer. Each is registered in a child context, so a removed Prowlarr indexer (or
  disabling this plugin) removes it from Magpie; they show as read-only in our UI.
- *arr-compat API shim (`/api/v3/system/status`, `/api/v3/indexer`, `/api/v3/indexer/schema`,
  `/api/v3/indexer/test`) so Prowlarr can instead **push** indexers to us by adding us as
  a "Radarr" and/or "Sonarr" application. Contract tests pin the exact payloads Prowlarr
  sends.
- Grab and failure results reported back to Prowlarr's history where its API allows.

**Exit:** indexers from an existing Prowlarr appear and search works, both via pull and via
Prowlarr's app sync.

Out of scope: running indexer site definitions ourselves (Cardigann), FlareSolverr —
Prowlarr already does both.

### Phase 7 — Subtitles (Bazarr replacement)
- `plugins/subtitles`: subtitle profiles (languages, forced, hearing-impaired, cutoff),
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
- Download clients: Transmission, Deluge, SABnzbd, NZBGet (usenet: no seeding, `nzo_id`
  refs, post-processing status handling).
- Notifiers: Discord, Telegram, ntfy, generic webhook, email; media server refresh
  (Plex, Jellyfin, Emby) on import.
- Overseerr/Jellyseerr compatibility: extend the `/api/v3` shim with movie/series
  add/lookup, quality profile and root folder listing, as used by those apps.
- Import lists: TMDB lists, Trakt, IMDb lists, Plex watchlist.
- Metadata: `metadata-anidb` for anime; `metadata-tvdb` (v4 API, subscriber PIN);
  `mapping-xem` scene numbering; TMDB episode groups for alternate orderings (moved from
  Phase 4).

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
| New media kinds without core changes | Phase 4.5 |
| Podcasts, books (ebooks + audiobooks), music | Phases 4.6–4.8 |
| Prowlarr integration | Phase 6 |
| TMDB + TVDB + others as plugins | §3.1, §3.3, Phases 3/4/8 |
| Docker, PUID/PGID, config dir layout | §8 |

## 8. Distribution & configuration

- **Docker image** (primary): `node:24-slim` base + `ffprobe`, runs as `PUID/PGID`,
  `UMASK` respected for created files, volumes `/config` and media paths, healthcheck
  endpoint `/api/v1/health`.
- **Config dir layout:**
  ```
  /config
    magpie.yml        # cordis loader config: which plugins, their settings
    magpie.db         # SQLite (WAL mode)
    backups/
    logs/
    cache/             # images
    plugins/           # user-installed plugins (via plugin-market)
  ```
- Secrets (API keys) can come from env vars referenced in `magpie.yml`
  (`${TMDB_API_KEY}`); never logged.
- Bare-metal: `npx magpie` with the same layout under the OS data dir.

## 9. Testing strategy

- **Parser:** golden fixtures (Phase 2), run on every PR.
- **Decision engine:** table-driven unit tests per rule.
- **Providers:** recorded HTTP fixtures with `msw`; one opt-in live test per provider
  (skipped in CI unless secrets exist).
- **Orchestrator:** integration tests with a temp SQLite DB, fake indexer (Torznab XML
  server), fake download client, and a temp filesystem — covering restart in every
  state of §5.1.
- **Ownership rule:** a CI check that each plugin's schema and migration SQL only touch
  tables with its prefix; tests that a parent-table rebuild keeps child rows and that
  deletes cascade.
- **Migration runner:** rollback on error, hash-drift and downgrade refusal, concurrent
  plugin starts.
- **Import:** tests for hardlink, cross-device fallback (a tmpfs mount in CI), atomic
  replacement, permission errors.
- **Compatibility:** contract tests for the `/api/v3` shim against payloads captured from
  real Prowlarr/Overseerr.
- **UI:** Playwright smoke test of the Phase 3 exit flow against the fake services.
- **End-to-end (manual, per release):** docker-compose with real qBittorrent + Prowlarr.

## 10. Risks & constraints

| Risk | Mitigation |
|---|---|
| Cordis v4 is an RC; APIs may change | Pin exact versions; wrap Cordis APIs in `packages/app`; upgrade deliberately |
| Cordis WebUI is Koishi-oriented and lightly documented | Build the foundation in Phase 1 before any feature pages. Where `@cordisjs/client` lacks something, add it in `webui-base` or contribute upstream; no standalone-Vue fallback |
| Licensing: project is MIT; Radarr/Sonarr/Prowlarr/Bazarr are GPL-3.0 | Clean-room only: implement from public API docs and observed behavior, never copy their code or test files. Check each dependency's license in CI (`license-checker` allowlist) |
| TVDB v4 API requires a paid project key or user subscriber PIN | Make TVDB optional; TMDB works out of the box; user supplies their PIN |
| TMDB TV numbering differs from scene/TVDB | Per-series primary provider + episode groups + XEM |
| Indexer sites break or block | Handled by Prowlarr; Magpie backs off and marks the indexer unhealthy |
| Scope is large (four mature apps) | Phase 3 MVP first; each later phase is independently shippable |
| Our own schema layer is code we maintain | Kept small (registration + migration runner); Drizzle does the SQL; crash and ownership tests in CI |
| `node:sqlite` still marked experimental; Drizzle's `node-sqlite` driver only in 1.0 RC | Phase 1 driver test; `better-sqlite3` fallback behind the same layer |

## 11. Decisions

| Decision | Choice |
|---|---|
| Name | Magpie (`@magpiejs/*`) |
| License | MIT (clean-room; see §10) |
| Download clients | qBittorrent first, Transmission second (both in the MVP) |
| UI | Cordis WebUI core packages only; all pages are ours; no stock pages, no standalone fallback |
| Metadata | TMDB + TVDB (+ AniDB later), each a plugin |
| Prowlarr | Use Prowlarr for indexers; Magpie integrates with it (Phase 6), doesn't replace it |
| Subtitles | Built in (Phase 7) |

| Database | SQLite + Drizzle with our `@magpiejs/database` layer: prefixed plugin-owned tables, per-plugin versioned migrations, real foreign keys (§3.0.1, §4.2) |
| Architecture | Every feature is a plugin (§3.0); no central schema-owning core |
