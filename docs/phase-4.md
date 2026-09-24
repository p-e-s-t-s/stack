# Phase 4 — TV

Detailed plan for Phase 4 of [PLAN.md](PLAN.md#phase-4--tv). Goal: add a series in the web
console and have Magpie keep it complete, episode by episode or a season pack at a time,
with the same search, download, import and upgrade loop movies have.

## 1. Scope

**In:** series metadata from TMDB (seasons, episodes, air dates), the `series` plugin
(tables, pages, monitoring options), episode and season-pack search, grabbing and import
(including multi-episode files), standard, daily and anime series, specials, automation
(search on add, RSS, wanted sweep, failed-download retry), and a calendar page with an
iCal feed.

**Out (for now):** TVDB (its API needs a paid subscriber PIN; it comes as its own plugin in
Phase 8, and TMDB stays the default), scene numbering from XEM (Phase 8; the parser and
matcher already accept absolute numbers), alternate episode orderings (TMDB episode groups,
Phase 8), and importing an existing TV library (Phase 5).

## 2. How it differs from movies

- **Many wanted units per item.** A series is one library item with many episodes. Each
  episode is monitored, has air date and file state, and is searched and upgraded on its
  own. A season pack is one download that covers many episodes.
- **What a download covers.** Downloads stay generic: a grab belongs to one library item.
  The `series` plugin records which episodes a grab covers in its own side table
  (`series_grab_episodes` → `downloads_grabs`), and adds its own "already downloading" rule
  that looks at episodes rather than the whole series.
- **What a file covers.** A library file can hold several episodes (`S01E01E02`). The
  `series` plugin maps files to episodes in `series_episode_files` → `library_media_files`.
- **Import by file.** A season pack holds many videos. Each file is parsed on its own and
  mapped to episodes; samples and extras are skipped; anything that can't be mapped is
  reported, not guessed.

## 3. Plugins

| Plugin                    | Provides                                                                 | Owns                                                                                                  | Depends on                        |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@magpiejs/metadata-tmdb` | adds TV: search, series details, seasons and episodes, external ids      | —                                                                                                     | metadata, http                    |
| `@magpiejs/series`        | series kind, monitoring, episode search and matching, series pages       | `series_details`, `series_seasons`, `series_episodes`, `series_episode_files`, `series_grab_episodes` | library, metadata, jobs, decision |
| `@magpiejs/import`        | becomes generic: a kind registers how its downloads are imported         | —                                                                                                     | library, downloads                |
| `@magpiejs/calendar`      | Calendar page and an iCal feed of upcoming episodes (and movie releases) | —                                                                                                     | series or movies (optional)       |

`library` gains series naming templates. `downloads` keeps its "already downloading" rule
for movies only; `series` adds the episode-aware one.

## 4. Key behaviors

### 4.1 Adding and monitoring

- Add from a TMDB search: quality profile, root folder, series type (standard, daily,
  anime), season folders on/off, and what to monitor: **all episodes**, **future
  episodes**, **missing episodes**, **first season**, **latest season**, or **none**.
  Specials (season 0) are never monitored unless you tick them.
- Monitoring can be changed per series, per season and per episode later.
- A daily metadata refresh adds new episodes (monitored if the series' choice says so),
  updates titles and air dates, and removes episodes TMDB dropped (unless they have files).

### 4.2 Searching

- **Episode search:** `t=tvsearch` with `season`/`ep` and TVDB/TMDB/IMDb ids when the
  indexer supports them, else `q=title`. Daily series search by air date; anime by
  absolute number as well.
- **Season search:** when a whole aired season is wanted, try a season pack first, then
  fall back to episodes.
- **Matching a release to a series:** ids from the indexer first, then normalized title
  (or an alternate title) — no year needed. Then its season and episodes must be wanted.
- Every result goes through the decision engine with an `episode` or `season` target; the
  upgrade check compares against the worst file among the episodes it covers.

### 4.3 Import

1. List the video files in the download (skip samples and extras).
2. Parse each file name (falling back to the release name for a single file) and map it
   to episodes: season + episode numbers, air date for daily series, absolute number for
   anime.
3. Check it's still an upgrade for those episodes.
4. Hardlink/copy/move exactly like movies, named from the series templates:
   `{Series Title} ({Year})/Season {season:00}/{Series Title} - S{season:00}E{episode:00} - {Episode Title} [{Quality}]`.
5. Record the file with its episodes, recycle replaced files, history, events.

A season pack imports every file it can map; unmapped files are listed in the history
entry and the grab is marked imported if at least one wanted episode was imported.

### 4.4 Automation

Same triggers as movies: search on add, RSS every 15 minutes (per episode match), a daily
sweep of wanted episodes (aired, monitored, missing or below cutoff), and a new search
after a failed download.

### 4.5 Calendar

A Calendar page (upcoming and recent episodes, with state) and an iCal feed at
`/api/v1/calendar.ics?apikey=…` for phones and calendar apps.

## 5. Pages

- **Series:** poster grid with episode counts (e.g. `18 / 20`) and status.
- **Add series:** TMDB search, then profile, folder, type, monitoring, "search now".
- **Series detail:** header like the movie page, then one section per season (collapsed
  except the latest) with monitor toggles, a season search, and a row per episode:
  number, title, air date, file/quality or state, and per-episode search.
- **Calendar**, and series entries in Activity and History.

## 6. Testing

- TMDB TV mapping against recorded responses.
- Episode matching and file-to-episode mapping (standard, multi-episode, season pack,
  daily, anime absolute) as unit tests.
- One end-to-end test per series type with the fake Torznab/qBittorrent servers:
  add → search → grab (a season pack for the standard series) → import.

## 7. Milestones

| #   | What                                                                                  |
| --- | ------------------------------------------------------------------------------------- |
| 4a  | TMDB TV; `series` plugin (tables, add with monitoring options, refresh); Series pages |
| 4b  | Episode and season search, interactive search, grabbing, episode-aware rules          |
| 4c  | Generic import; episode import (packs, multi-episode, naming)                         |
| 4d  | Automation (on add, RSS, wanted sweep, failed retry)                                  |
| 4e  | Daily and anime series; specials                                                      |
| 4f  | Calendar + iCal; end-to-end tests                                                     |

## 8. Exit criteria

A standard, a daily and an anime series each go from add → import correctly with the
fake services, including a season pack for the standard one; episodes upgrade when a
better release appears.

## 9. Decisions

- **TMDB is the TV metadata provider.** It needs no extra key. TVDB comes later as an
  optional plugin; series store TVDB ids (from TMDB's external ids) for indexer queries.
- **Downloads and library stay generic.** Episode knowledge lives in `series`' own tables,
  linked by foreign keys to grabs and files.
