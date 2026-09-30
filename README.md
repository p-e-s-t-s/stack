# Magpie

A single-process media manager, planned as a replacement for Radarr, Sonarr and Bazarr
that works with Prowlarr for indexers, built on the [Cordis](https://github.com/cordiverse/cordis) plugin kernel. Every
feature is a plugin that owns its own data, jobs and web console pages, and can be enabled,
reconfigured or removed at runtime. See [docs/PLAN.md](docs/PLAN.md) for the full plan.

**Status:** Phases 1–4.8 and most of 7 are built: movies, TV, podcasts, books and music
(search, grab, import, automation, calendar), qBittorrent, Transmission, Deluge and direct-HTTP
download clients, TMDB, iTunes, Open Library and MusicBrainz metadata, library scan and
import, subtitles, and media info. Not started: Radarr/Sonarr migration, Prowlarr sync,
notifications, usenet clients and request-app compatibility (see the plan).

## Requirements

Node.js 22.13 or newer (CI uses Node 24).

## Getting started

```sh
npm install
npm run dev          # web console at http://localhost:6767, restarts on code changes
```

On first start Magpie creates a config directory (`./data` by default; change it with
`--config <dir>` or `MAGPIE_CONFIG_DIR`) containing:

```
magpie.yml        plugins and their settings (edited by the UI; hand edits are fine too)
data/magpie.db    SQLite database
data/backups/     automatic backups taken before migrations
```

For a production run, build the web console first:

```sh
npm run build
npm start
```

## Layout

| Path                  | What it is                                                 |
| --------------------- | ---------------------------------------------------------- |
| `packages/app`        | Entry point: boots Cordis with the loader and `magpie.yml` |
| `packages/types`      | Shared provider contracts (types only)                     |
| `packages/http-utils` | Per-host rate limiter and retry helpers                    |
| `plugins/database`    | `ctx.database`: per-plugin Drizzle schemas and migrations  |
| `plugins/jobs`        | `ctx.jobs`: persisted job queue and schedules              |
| `plugins/webui`       | The web console service with Magpie's own shell            |
| `plugins/system`      | System page: database, job queue, runtime settings         |

## Writing a plugin with its own tables

1. Pick a namespace (lowercase letters and digits) and add it to the plugin's
   `package.json`: `"magpie": { "namespace": "subtitles" }`.
2. Define tables in `src/schema.ts` with Drizzle. Every table name starts with
   `<namespace>_`. Reference other plugins' tables with foreign keys; never alter them.
3. Add `drizzle.config.ts` (see `plugins/jobs`) and run
   `npm run db:generate -w <package>` after every schema change. Commit the migrations;
   never edit one that has been released.
4. In the plugin, `inject: ['database']` (plus the owner of any table you reference) and
   call `ctx.database.register({ namespace, schema, migrations })`.

## Plugin page navigation

Register visible console pages with `registerPage` from `@magpiejs/console-kit/navigation`:

```ts
import { registerPage } from '@magpiejs/console-kit/navigation'

registerPage(ctx, {
  path: '/catalog',
  name: 'Catalog',
  component: Catalog,
  order: 900,
  navigation: { group: 'library', icon: 'books', aliases: ['/item'] },
})
```

Navigation groups are `library`, `activity`, `configuration`, `system`, and `other`.
Configuration and system pages appear inside Settings. The shell uses metadata,
not URL conventions, to choose a group. Higher page `order` appears first;
ties sort by page ID. Disabled pages do not appear in navigation.

`icon` selects a shell SVG icon (`movies`, `series`, `podcasts`, `books`, `music`,
`calendar`, `activity`, `history`, `settings`, or `other`); unknown icons use `other`.
`aliases` declares additional route prefixes that should highlight this page.
The page's own path and descendants are matched automatically.

Set `navigation.default: true` for the preferred landing page or preferred Settings
page. Defaults are resolved independently for primary navigation and Settings.
If multiple defaults exist, group order then page order decides; without a default,
the first available page is used. Group order is Library, Activity, Other for primary
navigation, and Configuration, System for Settings.

Keep detail and add routes registered through Cordis with `disabled: () => true`.
Existing enabled pages without metadata appear under Other for compatibility.
Add `@magpiejs/console-kit` to the plugin's dependencies when using the helper.

## Browse discovery

`@magpiejs/browse` provides `/browse`. New installations enable it by default; existing
installations can add `- name: '@magpiejs/browse'` to `magpie.yml`.
The page appears when a registered library kind contributes `browse: { addPath,
detailPath }`. Disabling that kind removes its shelves and actions immediately.
Metadata providers optionally expose `discoveryFeeds` and `discover(feedId, region)`;
Browse intersects those capabilities with the live kind registry, without depending on
movie, TV, or provider implementations. Providers without discovery continue to work.

Enable TMDB with an API key in Metadata settings for movie and TV shelves. Country
defaults to US; trending is TMDB interest, and new digital releases can include rental
or purchase while a film is still in theaters. Results are cached for 15 minutes;
library membership is checked afresh. Cards open existing library items or prefill
the kind's add-page search, keeping its quality and folder choices in that plugin.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm run check:ownership   # migrations only touch their plugin's tables
npm test
```
