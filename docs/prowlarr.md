# Prowlarr integration

`@magpiejs/indexer-prowlarr` takes Magpie's indexers from Prowlarr, which keeps doing indexer
site definitions and FlareSolverr. It has two ways in; use either or both.

Add it in Settings → Indexers → Prowlarr (it is a single entry).

## Pull: Prowlarr's v1 API

Set **url** (`http://prowlarr:9696`) and **apiKey** (Prowlarr's key). Magpie lists
`GET /api/v1/indexer` (header `X-Api-Key`) every **syncInterval** minutes (15) and registers one
Torznab/Newznab indexer per enabled Prowlarr indexer, searched through Prowlarr's own proxy
(`{url}/{id}/api`). Priority, RSS and search support come from Prowlarr. An indexer removed
or disabled in Prowlarr is removed here at the next look. While Prowlarr is unreachable the
indexers last seen stay, and the failure is logged.

## Push: the Radarr/Sonarr v3 API

In Prowlarr, Settings → Apps → add **Radarr** and/or **Sonarr**:

- Prowlarr Server: Magpie's address (`http://magpie:6767`, no path)
- Server / API key: an API key made in Magpie with the **manager** role
- Sync level: as you like (Full sync adds, updates and removes)

Prowlarr then calls, under `/api/v3`: `GET system/status`, `GET indexer`, `GET indexer/schema`,
`POST indexer/test`, `POST/GET/PUT/DELETE indexer[/{id}]`, `GET/POST tag`. Pushed indexers are
kept in Magpie's database (`prowlarr_pushed`) exactly as sent, so Prowlarr sees no difference
when it compares. Pushing needs `downloads.manage`: an API key is never an administrator, so
`settings.manage` cannot be asked of it. Turn it off with `acceptPush: false`.

Magpie reports itself as Radarr/Sonarr version `5.0.0.0` (hidden `version` setting) so
Prowlarr's minimum-version check passes; `appName` is `Magpie`.

## One feed, one indexer

Radarr and Sonarr each push every Prowlarr indexer, and pulling lists them again. Indexers
with the same feed address and key are registered once (pulled first). Pushed categories
are ignored: Magpie searches each kind with its own categories (the Prowlarr proxy filters by
the `cat` it is sent).

## Status

The v3 payloads are written from Prowlarr's application-sync behaviour as known, and tested
against fakes. **Not yet verified against a live Prowlarr**; the fields Prowlarr requires in
`indexer/schema` or `system/status` may need adjusting. Not built: reporting grabs back to
Prowlarr's history, and a bare `/api/v3` is taken by this plugin (see
[request-app-compatibility.md](request-app-compatibility.md), which plans namespaced
`/api/compat/*` bases).
