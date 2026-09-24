# Phase 3 — Movies end to end (MVP)

Detailed plan for Phase 3 of [PLAN.md](PLAN.md#phase-3--mvp-movies-end-to-end). Goal: add a
movie in the web console and have Magpie find it through Prowlarr, send it to qBittorrent
or Transmission, and import the finished download into your library — then keep upgrading
it until the profile's cutoff is met.

## 1. Scope

**In:** TMDB metadata, Torznab/Newznab indexers (which covers Prowlarr), qBittorrent and
Transmission, grabbing, download tracking, import with hardlinks, upgrades, the movie
pages, activity, settings, and login.

**Out:** TV (Phase 4), existing-library scan and Radarr migration (Phase 5), Prowlarr sync
(Phase 6 — until then you paste Prowlarr's per-indexer URLs), notifications and other
download clients (Phase 8).

## 2. The flow

```
 add movie ──▶ search job ──▶ indexers.search ──▶ decision.evaluateAll ──▶ best accepted
    ▲                                                                        │
    │ (RSS every 15 min, wanted sweep daily)                              grab
    │                                                                        ▼
 upgrade ◀── import ◀── completed ◀── download monitor (every 60 s) ◀── download client
 (until cutoff)   │
                  └──▶ library file + history + events (UI updates live)
```

Every step is a job in `@magpiejs/jobs`, so a restart resumes where it stopped.

## 3. Plugins

| Plugin                              | Provides                                                                     | Owns                                                                                             | Depends on              |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `@magpiejs/metadata`                | `ctx.metadata` provider registry, image cache                                | —                                                                                                | —                       |
| `@magpiejs/metadata-tmdb`           | TMDB provider: search, movie details, release dates, IDs                     | —                                                                                                | metadata, http          |
| `@magpiejs/library`                 | `ctx.library`: media items, files, root folders, naming                      | `library_media_items`, `library_media_files`, `library_root_folders`, `library_alternate_titles` | database, decision      |
| `@magpiejs/movies`                  | movie kind, availability, search triggers, movie pages                       | `movies_details` (→ `library_media_items`, cascade)                                              | library, metadata, jobs |
| `@magpiejs/indexers`                | `ctx.indexers` registry, search fan-out, RSS sync, health                    | `indexers_status`                                                                                | jobs, decision          |
| `@magpiejs/indexer-torznab`         | Torznab and Newznab indexer (one plugin instance per indexer)                | —                                                                                                | indexers, http          |
| `@magpiejs/downloads`               | `ctx.downloads` client registry, grab, monitor, blocklist and in-queue rules | `downloads_grabs`, `downloads_blocklist`                                                         | jobs, decision, library |
| `@magpiejs/downloader-qbittorrent`  | qBittorrent Web API v2 client                                                | —                                                                                                | downloads, http         |
| `@magpiejs/downloader-transmission` | Transmission RPC client                                                      | —                                                                                                | downloads, http         |
| `@magpiejs/import`                  | import pipeline, rename, recycle bin                                         | —                                                                                                | library, downloads      |
| `@magpiejs/history`                 | activity log                                                                 | `history_events`                                                                                 | database                |
| `@magpiejs/auth`                    | login, sessions, API keys; guards the web console and API                    | `auth_users`, `auth_api_keys`                                                                    | database, server        |
| `@magpiejs/api`                     | REST helper under `/api/v1`                                                  | —                                                                                                | server, auth            |

Indexers and download clients are loader entries: adding one in Settings adds an entry
to `magpie.yml` (URL, API key, category…), which starts a plugin instance that registers
itself into `ctx.indexers` / `ctx.downloads`. Disabling it removes it immediately.

## 4. Key behaviors

### 4.1 Movies and availability

- Adding a movie stores TMDB ID, IMDb ID, title, year, alternate titles, runtime and
  release dates (in cinemas, digital, physical), with a quality profile and root folder.
- **Minimum availability** per movie: announced, in cinemas, or released (digital or
  physical). Automatic searches wait until then; interactive search always works.
- Metadata refresh job (daily) keeps dates, titles and posters current.

### 4.2 Searching

- **On add** (optional checkbox), **daily wanted sweep** (missing, then cutoff-unmet,
  bounded batch, oldest-searched first), **RSS** every 15 minutes per indexer, and
  **interactive** from the movie page.
- Torznab queries use IMDb/TMDB IDs when the indexer supports them (Prowlarr does), and
  fall back to `title year`.
- **Matching a release to a movie:** IDs returned by the indexer first; otherwise
  normalized title (or an alternate title) plus year ±1.
- Every result goes through `decision.evaluateAll`; interactive search shows all of them
  with reasons and a manual **Grab** button (which can override a rejection).
- Per-indexer rate limits, timeouts and backoff; an indexer that keeps failing is
  disabled for a while and shown as unhealthy.

### 4.3 Grabbing and monitoring

- The best accepted release is sent to the highest-priority enabled client for its
  protocol, with a Magpie category/label.
- A grab row tracks it: `grabbed → downloading → import_pending → imported`, or
  `failed` / `import_failed`.
- The monitor polls clients every 60 s, updates progress (pushed to the UI live), detects
  stalled downloads (no progress for a configurable time), and handles removals.
- A failed download is blocklisted and the movie is searched again.

### 4.4 Import

1. Take the download's path as the client reports it (paths are mapped outside Magpie).
2. Pick the main video file (skip samples and extras).
3. Re-check it's still an upgrade over what's on disk now.
4. **Hardlink** into the movie folder; if that fails across filesystems, **copy** (torrents
   keep seeding either way). Write to a temporary name, then rename into place.
5. Name it from a template, default `{Title} ({Year})/{Title} ({Year}) [{Quality}].{ext}`.
6. Move a replaced file to the recycle bin folder (if set) or delete it.
7. Record the file, add history, emit `import/completed`.

`ffprobe`, if installed, confirms resolution and codecs; without it the release name is
trusted.

### 4.5 Login

Single admin user created on first start (the console asks for a password), session
cookie for the web console and its WebSocket, API keys for `/api/v1`.

## 5. Pages

- **Movies:** poster grid / list with status (missing, downloading, downloaded, cutoff
  met), filters and sort.
- **Add movie:** TMDB search, then profile, root folder, availability, "search now".
- **Movie detail:** metadata, file, history, **interactive search** table (quality,
  format score, size, seeders, indexer, accept/reject with reasons, Grab).
- **Activity:** queue (live progress, remove/blocklist) and history.
- **Settings:** Indexers and Download clients (add/edit/test/disable, backed by the
  loader), Media management (root folders, naming, hardlink/copy, recycle
  bin), General (login, API key).

## 6. Testing

- A **fake Torznab server** and **fake qBittorrent / Transmission servers** (small HTTP
  servers in the test suite) exercise the real plugins end to end.
- Import tests use temp folders, including a forced cross-device error to test the copy
  fallback.
- One end-to-end test: add movie → search → grab → fake client completes → import →
  movie shows downloaded; then a better release appears in RSS → upgrade.
- Tests stay proportionate: the happy path plus the failure paths that matter
  (failed download, import failure, restart mid-download).
- First real run is yours: Prowlarr + your client + your folders.

## 7. Milestones

| #   | Deliverable                                                                                         |
| --- | --------------------------------------------------------------------------------------------------- |
| 3a  | `metadata` + `metadata-tmdb`, `library` + `movies` (add, list, refresh); Movies and Add movie pages |
| 3b  | `indexers` + `indexer-torznab`; interactive search on the movie page                                |
| 3c  | `downloads` + qBittorrent; manual grab; Activity queue                                              |
| 3d  | Transmission client                                                                                 |
| 3e  | `import`: hardlink/copy, naming, recycle bin; history                                               |
| 3f  | Automation: search on add, RSS, wanted sweep, upgrades, failed-download retry                       |
| 3g  | `auth` + `api`; Settings pages                                                                      |
| 3h  | End-to-end test and a first real run with you                                                       |

After 3c you can already search Prowlarr and send a release to qBittorrent by hand.

## 8. Exit criteria

Add a movie in the UI → it's found through Prowlarr → sent to qBittorrent or
Transmission → imported by hardlink with the right name → shown as downloaded; a better
release later appearing in RSS replaces it.

## 9. What you'll need

- **TMDB API key** (free, themoviedb.org → Settings → API).
- **Prowlarr** with at least one indexer; Magpie uses each indexer's Torznab URL from
  Prowlarr and Prowlarr's API key.
- **qBittorrent** (Web UI enabled) or **Transmission** (RPC enabled), reachable from
  Magpie.
- **Folders:** where the client saves downloads and where your movie library lives.
  For hardlinks both must be on the same filesystem; if the client runs in Docker, note
  how its paths map to paths on the Magpie side.

## 10. Decisions

- **Login is always required** (no local-network bypass).
- **Paths are mapped outside Magpie** (Docker volumes set up so Magpie and the download
  client see the same paths). Magpie uses the client's reported path as-is; remote path
  mappings are dropped from Phase 3 and can return later if needed.
