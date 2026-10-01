# Import lists

Implementation plan for the "Import lists" item in Phase 8 of [PLAN.md](PLAN.md).
Status: **planned, nothing built**. Sources named in PLAN.md: TMDB lists, Trakt, IMDb lists
and the Plex watchlist.

## Outcome and scope

An import list is an external, user-owned list of titles. Magpie syncs it on a schedule
and adds any titles it does not already have to the library, using the add path the UI
already uses. Lists are one-way: Magpie never writes back to the source.

In scope for the first cut: movies and series (the kinds that have TMDB/IMDb ids).
Out of scope: books, music and podcasts lists, writing back to a source, and removing
library items when they leave a list (see Decisions).

## Architecture

Follows the existing plugin model (§3.0, §3.1): a feature plugin owns the registry and
state, provider plugins register into it for their lifetime through `ctx.effect`, the
same way `@magpiejs/metadata` and `@magpiejs/notifications` do.

| Package                                                    | Role                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `@magpiejs/import-lists`                                   | `ctx.importLists` registry, sync job, tables, REST routes, Settings → Import lists page |
| `@magpiejs/list-{tmdb,trakt,imdb,plex}` (provider plugins) | One per source; each implements `ImportListProvider`                                    |

`import-lists` injects `library`, `metadata`, `jobs` and `api`. It does not import
`movies` or `series` directly: it adds items through the per-kind add path (the same
call behind `POST /movies` and the series equivalent), so disabling a kind just means
entries of that kind are skipped.

### Provider contract

```ts
interface ImportListProvider {
  id: string // 'tmdb', 'trakt', 'imdb', 'plex'
  kinds: ('movie' | 'series')[]
  fetch(opts: FetchOptions): Promise<ListEntry[]> // whole list, paginated internally
  test(): Promise<TestResult>
}

interface ListEntry {
  kind: 'movie' | 'series'
  title: string
  year?: number
  ids: { tmdb?: number; imdb?: string; tvdb?: number } // at least one when possible
}
```

Providers only return entries. Resolving ids, de-duplication and adding happen in
`import-lists`, so a provider stays a thin HTTP client built on `@magpiejs/http-utils`
(rate limiting and retry already exist there).

Instance config follows the existing rule: connection details live in the plugin's
`magpie.yml` entry (schemastery schema, rendered by Settings → Integrations); sync state
lives in the database.

## Data model

Tables are prefixed `importlists_` and reference only `library` ids.

- `importlists_lists`: `id`, `entry_id` (loader entry), `name`, `kind_filter`,
  `enabled`, `profile_id`, `root_folder_id`, `monitor`, `search_on_add`,
  `last_synced_at`, `last_error`, `etag` / provider cursor.
- `importlists_seen`: `list_id`, `external_key` (e.g. `tmdb:movie:603`),
  `media_id` (nullable, set null on library delete), `first_seen_at`, `last_seen_at`,
  `status` (`added`, `existing`, `excluded`, `unmatched`).
- `importlists_exclusions`: `external_key`, `title`, `created_at`. Titles the user
  deleted or rejected so a list never re-adds them.

`importlists_seen` is what makes syncs idempotent and keeps a title the user removed
from coming back, even if no exclusion row was written.

## Sync flow

1. Job `importlists.sync` per list, scheduled on a per-list interval (default 12 h,
   minimum 1 h to protect source APIs). Manual "Sync now" queues the same job.
2. `provider.fetch()` returns entries. A failure records `last_error`, backs off with
   the jobs queue's retries, and leaves everything else untouched.
3. For each entry: resolve to a canonical key via `ctx.metadata` (`mapIds`, search by
   title/year as a last resort). No match → `unmatched`, shown in the UI, never guessed.
4. Skip if the key is excluded, already in the library, or already `seen`.
5. Otherwise add through the kind's add path with the list's profile, root folder and
   monitor setting; record `seen`; emit the existing `media/added` event.
6. Searching for downloads happens only if the list has `search_on_add` set, matching
   how library adoption behaves (new items default to unmonitored there; here the
   user chooses per list, default **monitored, search on**, since adding is the point).

Large lists are processed in bounded batches per job run so one sync cannot block the
queue; a crash mid-run is safe because `seen` rows are written with each add.

## Providers

| Provider | Auth                                         | Notes                                                                                                                                                            |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TMDB     | Existing `metadata-tmdb` key, list id or URL | Lists v4 (`/4/list/{id}`) for public lists; user watchlist/favorites need a TMDB user token. Easiest provider, ships first.                                      |
| Trakt    | OAuth device flow; client id/secret          | Watchlist, custom lists, popular/trending (optional). Token refresh must be stored and rotated; surface re-auth in health checks.                                |
| IMDb     | None, public list URL or `ls…` id            | No official API. Use the public CSV export; fragile by nature. Mark as best effort and fail with a clear message when the list is private or the format changes. |
| Plex     | Plex token                                   | Cloud watchlist via `discover.provider.plex.tv`. Items carry guids, so ids resolve without title search.                                                         |

## UI

Settings → Import lists, built with the same pattern as Notifications: add/edit a list
from a provider form, **Test**, **Sync now**, last-sync status, and an expandable
result view (added / existing / excluded / unmatched). Unmatched entries get a
manual-match action; the exclusions list is editable. A health check reports lists
that have failed repeatedly or whose OAuth token expired.

## Decisions to make before building

1. **Removal.** Default: never remove library items when they leave a list. Optional
   later: per-list "unmonitor when removed" (still no file deletion).
2. **Exclusions.** Add a title to exclusions automatically when the user deletes a
   list-added item? Recommended yes, with a "don't add again" checkbox on delete.
3. **Defaults per list vs global.** Recommended per list (profile, root folder,
   monitor), because lists often map to different libraries.
4. **IMDb.** Accept fragility, or drop it from the first release? Recommended: ship it
   last and label it best effort.
5. **Request-app overlap.** [Request-app compatibility](request-app-compatibility.md)
   already adds titles from Seerr. Lists and requests should share the add helper so
   defaults and `media/added` behaviour stay identical.

## Build order

1. `import-lists` core: tables, registry, sync job, add path, exclusions, REST routes
   (tested with a fake provider from `@magpiejs/testing`).
2. Settings page and health check.
3. `list-tmdb`.
4. `list-plex`.
5. `list-trakt` (OAuth is the largest piece).
6. `list-imdb`.

## Acceptance checks

- Syncing the same list twice adds each title once.
- A title the user deleted and excluded is never re-added.
- A provider outage or expired token leaves the library unchanged and shows the error.
- Ambiguous titles stay `unmatched` and are never added automatically.
- Disabling `import-lists` or a provider removes its jobs, routes and page; tables stay.
- Respecting source rate limits: no list syncs more often than hourly.
