# Magpie

A single-process media manager, planned as a replacement for Radarr, Sonarr and Bazarr
that works with Prowlarr for indexers, built on the [Cordis](https://github.com/cordiverse/cordis) plugin kernel. Every
feature is a plugin that owns its own data, jobs and web console pages, and can be enabled,
reconfigured or removed at runtime. See [docs/PLAN.md](docs/PLAN.md) for the full plan.

**Status:** Phase 1 (foundations). No media features yet.

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

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm run check:ownership   # migrations only touch their plugin's tables
npm test
```
