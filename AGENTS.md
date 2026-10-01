# AGENTS.md: building plugins for Magpie

> The project is **Magpie** (npm scope `@magpiejs/*`). This file is the one-stop reference for
> anyone, human or agent, who writes or changes a plugin. It was written from the source tree,
> so every service, event, slot and contract below exists in code; where a detail matters, the
> file to check is named. **If the code and this file disagree, the code wins. Fix this file in
> the same change.**

## 0. Before you write any code: investigate how plugins work

Every agent must do this first, every time. Do not rely on memory of Cordis, Koishi or the
\*arr apps; Magpie's contracts are its own.

1. Read this file completely.
2. Read the plugin closest to what you are building and copy its shape (table in §14).
   `plugins/history` is the smallest complete feature plugin (service, own table, events,
   console page, slots). `plugins/podcasts` is the smallest complete _kind_ plugin.
   `plugins/notifier-webhook` / `plugins/indexer-torznab` are the reference _providers_.
3. Search for the registry or event you will touch and read its owner, not just its types:
   `grep -rn "ctx.<service>\." plugins/*/src`, `grep -rn "'<event>'" plugins/*/src`,
   `grep -rn "k-slot" plugins/*/client`.
4. Read the relevant doc in `docs/` (index in §16). `docs/PLAN.md` is the design record;
   `docs/phase-*.md` explain why each part exists.
5. Run the checks (§13) _before_ you change anything so you know the baseline.
6. Look at the matching test, and write yours the same way (§12).

Hard rules that bite people who skip this:

- **A plugin only creates and changes its own tables** (§5). CI enforces it.
- **Never edit a released migration** (§5). The runner refuses to start the plugin.
- **Optional dependencies go through `ctx.inject([...], cb)`**, not `static inject`
  (§3.3), or the plugin cannot start without them.
- **Everything you register must go through `ctx.effect`/the service's `register`** so disposing
  the plugin removes it. Never leave a global listener, timer or route behind (§3.2).
- **A web console entry with no `access` is administrators-only** (§8.2).
- **Magpie is clean-room.** Radarr, Sonarr, Prowlarr and Bazarr are GPL-3.0; implement from public API
  docs and observed behavior only, never copy their code or tests.

## 1. What Magpie is

A single-process media manager (movies, TV, podcasts, ebooks, audiobooks, music, subtitles)
meant to replace Radarr, Sonarr, Bazarr, Lidarr and Readarr, working with Prowlarr for indexers.
It is built on the [Cordis](https://github.com/cordiverse/cordis) plugin kernel (`cordis`
`4.0.0-rc.10`, pinned; v4 is a release candidate, so never bump casually).

**Every feature is a plugin that owns its own data, jobs, routes and console pages, and can be
enabled, reconfigured or removed at runtime.** There is no central schema-owning core. The only
non-plugin code is the entry point (`packages/app`), shared types and pure-logic libraries.

Tech: Node ≥ 22.13 (CI uses 24), TypeScript 6 strict, ESM only, npm workspaces, `node:sqlite`
with Drizzle ORM (`1.0.0-rc.4`), `schemastery` config schemas, Vue 3 + `@cordisjs/client` for the
console, Vite 7 for the console build, Vitest for tests. Code runs from TypeScript source through
`tsx`.

## 2. Repository layout

```
packages/app            entry point: boots Cordis + @cordisjs/plugin-loader, writes magpie.yml (§3.5)
packages/types          shared contracts: MediaKinds, providers, ReleaseInfo, Permission… (types only)
packages/http-utils     RateLimiter, retry, backoffDelay
packages/parser         release-name parser (video), normalizeTitle, foldedWords/WordCover
packages/probe          ffprobe wrapper
packages/units          shared search/automation for kinds whose items have parts (§9.4)
packages/console-kit    shared Vue components, navigation helpers, theme engine (client side)
packages/testing        createTestContext + fake Torznab / download client (§12)
plugins/<name>          every feature and provider; package name @magpiejs/<name>
scripts/                build-webui, check-ownership, fixtures tooling
docs/                   design docs (§16)
```

Plugin folder anatomy (not every part is required):

```
plugins/<name>/
  package.json          name, exports, `magpie` block, deps
  src/index.ts          the plugin (Service class, or name/inject/Config/apply)
  src/schema.ts         Drizzle tables (prefixed <namespace>_)
  src/console.ts        server half of the console entry (addEntry)
  src/api.ts            REST routes under /api/v1
  client/index.ts       console client entry (pages, slots, regions)  → built to dist/
  client/*.vue          pages and slot components
  migrations/           drizzle-kit output, committed
  drizzle.config.ts     { dialect: 'sqlite', schema: './src/schema.ts', out: './migrations' }
  tests/*.test.ts
```

## 3. The Cordis model as Magpie uses it

### 3.1 Two plugin shapes

**Service plugin** (feature plugins and registries). A class extending `Service` that provides
`ctx.<name>`:

```ts
import { type Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    history: HistoryService
  } // typed ctx.history
  interface Events {
    'history/added'(event: HistoryEvent): void
  } // typed events (§6)
}

export class HistoryService extends Service {
  static inject = ['database', 'library'] // hard dependencies
  static Config = HistoryConfig // optional schemastery schema
  constructor(ctx: Context) {
    super(ctx, 'history')
  } // 'history' = the ctx property name
  [Service.init]() {
    /* register DB, jobs, listeners, console… (may be async or a generator) */
  }
}
export default HistoryService
```

`*[Service.init]()` may `yield () => cleanup` for teardown (see `jobs`, `database`).

**Function plugin** (providers: indexers, clients, notifiers, metadata, subtitles, media servers,
themes). Plain named exports, instantiated once per `magpie.yml` entry:

```ts
export const name = 'notifier-webhook'
export const inject = ['http', 'notifications']
export interface Config {
  name: string
  url: string
}
export const Config: z<Config> = z.object({
  name: z.string().default('Webhook'),
  url: z.string().role('secret'),
})
export function apply(ctx: Context, config: Config) {
  ctx.notifications.register({ id, events, send, test }, { name: config.name })
}
```

### 3.2 Lifecycle and `ctx.effect`

Disposing a plugin (disable, reload, config change, shutdown) must undo everything it did.
All registries do this through `ctx.effect(() => { register; return () => unregister }, label)`;
`ctx.on(...)`, `ctx.server.get/post(...)`, `ctx.api.*`, `ctx.webui.addEntry(...)` and
`ctx.plugin(child, ...)` are bound to the context they are called on and removed with it. A
disabled indexer therefore disappears from searches immediately.

Registry methods capture `const caller = this.ctx` so registration is tied to the _calling_
plugin's lifetime. Follow that pattern when you add a registry (see `jobs.define`).

Duplicate ids throw (`indexer X is already registered`); that is intended.

### 3.3 Dependencies: hard vs optional

- `static inject = [...]` / `export const inject = [...]`: the plugin does not start until
  these services exist, and restarts when they reload.
- Optional features: `this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))`.
  The callback and everything inside it run only while the service is loaded and are disposed
  when it goes away. **All console, API, calendar, import, download and subtitle integration of a
  kind or feature plugin is wired this way**, so e.g. disabling `webui` leaves a working headless
  Magpie.
- `ctx.get('downloads')` returns the service or `undefined` (used for one-off optional reads).
- A plugin with a foreign key into another plugin's table **must** inject that plugin's service,
  so the owner's migrations ran first (§5).
- Add `import type {} from '@magpiejs/<dep>'` for side-effect-only typing of a dep's
  `declare module 'cordis'` augmentation.

### 3.4 Config schemas

`schemastery` (`import z from 'schemastery'`). `.description()` is shown in the form,
`.role('secret')` makes a password field (secrets are never sent back to the console;
empty keeps the stored value), `.hidden()` hides it from the form, `.default()` makes it optional.
Instance config lives in `magpie.yml`; runtime state lives in the DB (e.g. an indexer's URL is its
entry config, its failure count is a row in `indexers_status` keyed by the entry id).

### 3.5 Loader, `magpie.yml`, stable ids

`packages/app/src/index.ts` boots `new Context()`, the `@cordisjs/plugin-loader`, and a
`@cordisjs/plugin-include` entry for `<configDir>/magpie.yml`. On first start the file is written
from `defaultConfig()`: the list of plugin packages (with `config`/`disabled`). **A new core plugin
must be added there** and to `packages/app/package.json` to ship enabled. Provider plugins are
instead added by users from Settings (`@magpiejs/settings`), which edits entries through the loader.

Provider instance ids must be stable across restarts so health history survives. Use the entry id:

```ts
const id = `torznab:${(ctx.fiber as { entry?: { options: { id: string } } }).entry?.options.id ?? config.name}`
```

Several instances of one provider plugin are normal (many indexers). Set `single: true` in its
`magpie.provider` block when only one makes sense (TMDB, iTunes).

### 3.6 Outbound HTTP, timers, logging

- Outbound HTTP: `ctx.http` from `@cordisjs/plugin-http` (inject `'http'`). Honors the proxy
  setting. Use `@magpiejs/http-utils` (`RateLimiter`, `retry`, `backoffDelay`) for per-host limits.
- Timers: `@cordisjs/plugin-timer` (`ctx.setInterval`, `ctx.debounce`, inject `'timer'`), disposable.
  For anything that must survive a restart use jobs (§7), not timers.
- Logging: `ctx.logger.info/warn(...)`. Never log secrets or full URLs (they may hold tokens).

## 4. Package conventions

`package.json` of a plugin:

```jsonc
{
  "name": "@magpiejs/<name>",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" }, // export ./schema if others read your tables
  "magpie": {
    "namespace": "<name>", // required if it has migrations (lowercase letters/digits)
    "provider": {
      "kind": "indexer",
      "label": "Torznab / Newznab (Prowlarr)",
      "single": false,
      "basic": ["name", "url", "apiKey"],
    },
  },
  "scripts": { "db:generate": "drizzle-kit generate" },
  "dependencies": { "@magpiejs/types": "0.0.0", "schemastery": "^3.18.0" },
  "peerDependencies": { "cordis": "4.0.0-rc.10" },
}
```

- Workspace deps are exact `0.0.0`. Pin `cordis`, `@cordisjs/*` and Drizzle exactly as the other
  plugins do.
- `magpie.provider.kind` ∈ `indexer | download-client | metadata | subtitle | notifier |
media-server`. `@magpiejs/settings` discovers every package whose `package.json` has it, imports
  its `Config` schema, and renders the add/edit form (`basic` lists fields shown up front, the rest
  go under "More options"). The package **must export `Config`** or it is not offered.
- Add `@magpiejs/console-kit` to dependencies if the client uses it; `@magpiejs/webui` as a
  devDependency if the server half types against it.
- Tests and sources are TypeScript-checked by the root `tsconfig.json` (`packages/*/src|tests`,
  `plugins/*/src|tests`, `scripts`). Client `.vue` files are not part of `tsc`; keep them simple.

## 5. Data: `@magpiejs/database`

```ts
this.db = this.ctx.database.register({
  namespace: 'subtitles', // table prefix
  schema, // Drizzle sqliteTable objects
  migrations: new URL('../migrations', import.meta.url), // drizzle-kit output
  steps: {
    '0000_init': (sqlite) => {
      /* TS data step in the same transaction */
    },
  }, // optional
}) // typed Drizzle instance (node:sqlite, synchronous)
```

Rules (all enforced):

1. **Table names start with `<namespace>_`** (`library_media_items`, `downloads_grabs`).
   `register()` throws if the schema declares a table outside the namespace;
   `npm run check:ownership` fails if a migration creates/alters/drops anything not yours.
2. **Never alter another plugin's tables.** To attach data, create your own table that references
   theirs: one-to-one → side table keyed by their id (`series_details.media_id`); one-to-many →
   child table.
3. **Real foreign keys**, declared against the owner's exported table:
   `.references(() => mediaItems.id, { onDelete: 'cascade' })`. Pick `cascade` / `set null` /
   `restrict` deliberately. Import their table from `@magpiejs/<owner>/schema`; **read** their
   tables directly, **write** only through the owner's service (`ctx.library.update(...)`).
4. **Migrations:** after any schema change run `npm run db:generate -w @magpiejs/<name>`, commit the
   output. Never edit a released migration (hash drift refuses to start the plugin); a DB with
   migrations the plugin doesn't know (downgrade) also refuses. Pending migrations take a
   `VACUUM INTO` backup first and run in one transaction with FK checks off and
   `PRAGMA foreign_key_check` before commit. Failure rolls back and only your plugin fails.
5. Nothing syncs schema at runtime; migration files are the only way the schema changes.
6. Disabling a plugin keeps its tables. `ctx.database.dropNamespace(ns)` (explicit "Delete data"
   only, refuses while loaded) is the only removal path.
7. The DB service is synchronous (`node:sqlite`): `.get()`, `.all()`, `.run()`, `db.transaction(tx => …)`.
   Reloading `database` restarts every dependent plugin.

Other `DatabaseService` members: `sqlite` (raw `DatabaseSync`), `backup(reason)`, `status()`,
`config` (`path` default `data/magpie.db`, `backupDir`, `backupRetention` 20, `busyTimeout`).

Per-plugin key/value settings are a common pattern: a `<ns>_settings(key text pk, value json)` table
(library, verify, subtitles, themes).

## 6. Service catalogue (what you can inject)

| Service (`ctx.…`)                            | Plugin                    | What it gives you                                                                                                      |
| -------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `database`                                   | `@magpiejs/database`      | `register`, `backup`, `status`, `dropNamespace`, `sqlite` (§5)                                                         |
| `jobs`                                       | `@magpiejs/jobs`          | persisted queue: `define`, `enqueue`, `schedule`, `get`, `list`, `tick` (§7)                                           |
| `auth`                                       | `@magpiejs/auth`          | users/roles/sessions/API keys; `can(identity, perm)`, `identity(req)`, `providers.register` (§8.5)                     |
| `api`                                        | `@magpiejs/api`           | REST under `/api/v1`: `get/post/put/patch/delete`, `as(permission)` (§8.6)                                             |
| `webui`                                      | `@magpiejs/webui`         | console backend: `addEntry`, `policy`, `broadcast` (§8)                                                                |
| `server`, `http`, `timer`, `loader`          | `@cordisjs/plugin-*`      | inbound HTTP/WebSocket, outbound HTTP, timers, plugin loader                                                           |
| `library`                                    | `@magpiejs/library`       | items, files, targets (extra versions), root folders, naming, kinds (§9.2)                                             |
| `decision`                                   | `@magpiejs/decision`      | quality families, profiles, custom formats, rules, `evaluate`/`evaluator`/`evaluateAll` (§9.3)                         |
| `metadata`                                   | `@magpiejs/metadata`      | provider registry: `register`, `get`, `for(kind, preferred?)`, `discovery()`, `list()`                                 |
| `indexers`                                   | `@magpiejs/indexers`      | `register`, `searchType`, `searchTypeOf`, `search`, `syncRss`, `health`, `usable`, `test`                              |
| `downloads`                                  | `@magpiejs/downloads`     | `register` (client), `grab`, `resolve`, `active`, `activeFor`, `unitsOf`, `setState`, `remove`, `block`, `listClients` |
| `import`                                     | `@magpiejs/import`        | `register(kind, importer)`, `guard`, `enqueue`, `importGrab`, `review.register(kind, adapter)`                         |
| `history`                                    | `@magpiejs/history`       | `add(mediaId, type, title, data)`, `list`                                                                              |
| `calendar`                                   | `@magpiejs/calendar`      | `source(kind, fn)`, `entries`; helper `entryState`                                                                     |
| `notifications`                              | `@magpiejs/notifications` | `register(notifier, {name})`, `destinations`, `test`, `recent`                                                         |
| `mediaServers`                               | `@magpiejs/media-servers` | `register(provider, options)`, `list`, `flush`                                                                         |
| `subtitles`                                  | `@magpiejs/subtitles`     | `register(provider)`, profiles, wanted/search/acquire                                                                  |
| `verify`                                     | `@magpiejs/verify`        | post-download checks: `check(name, fn, opts)`, `runtime(fn)`; installs an import guard                                 |
| `mediainfo`                                  | `@magpiejs/mediainfo`     | probed facts per file: `get`, `forMedia`, `ensure`, `enqueue`                                                          |
| `mediaTools`                                 | `@magpiejs/media-tools`   | ffprobe/ffmpeg paths: `path`, `available`, `check`, `save`, `adopt`                                                    |
| `health`                                     | `@magpiejs/health`        | `check(name, fn, {label, description, link})`, `run`, `list`, `level`                                                  |
| `backup`                                     | `@magpiejs/backup`        | zipped DB(+config) backups: `create`, `list`, `restore`, `settings`                                                    |
| `settings`                                   | `@magpiejs/settings`      | provider add/update/remove from the UI via the loader                                                                  |
| `theme`                                      | `@magpiejs/themes`        | `register(ThemeDefinition)`, `list`, `defaultId`, `resolve(userId)` (§10)                                              |
| `browse`                                     | `@magpiejs/browse`        | discovery shelves from metadata providers                                                                              |
| `movies` `series` `podcasts` `books` `music` | kind plugins              | each kind's own service (§9)                                                                                           |

Not services but plugins you will meet: `@magpiejs/system` (System page), `@magpiejs/decision`
console pages, `@magpiejs/compat-api` (planned `/api/v3` shim, see `docs/request-app-compatibility.md`).

### 6.1 Every event on the Cordis bus

Declared by `declare module 'cordis' { interface Events { … } }`. Emit with `ctx.emit(name, …)`,
listen with `ctx.on(name, fn)` (returns a disposer, and is auto-removed with the plugin).
Events are for fan-out (console refresh, notifications, subtitles). **State transitions are not
driven by events alone**: they go through the jobs queue and DB so a crash can't lose work.

| Event                                                                                                                                                                                                        | Emitted by                             | Meaning                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `library/added(item)` `library/updated(item)` `library/deleted(item)`                                                                                                                                        | library                                | a media item row changed                                                                                                                 |
| `library/file-added(item, file)` `library/file-removed(item, file)`                                                                                                                                          | library                                | a media file row was added/updated (`updateFile` also emits `file-added`) or removed                                                     |
| `library/root-folders()` `library/kinds()`                                                                                                                                                                   | library                                | root folders, registered kinds or naming schemes changed                                                                                 |
| `movies/added(movie, {search})` `movies/target-added(movie, target)`                                                                                                                                         | movies                                 | a movie was added; an extra version was added                                                                                            |
| `series/added(series, {search})` `series/episodes(mediaId)`                                                                                                                                                  | series                                 | series added; episodes/monitoring changed                                                                                                |
| `podcasts/added(podcast, {download})` `podcasts/episodes(mediaId)` `podcasts/refreshed(mediaId)`                                                                                                             | podcasts                               | podcast added; episodes changed; feed re-read                                                                                            |
| `books/added(follow, {search})` `books/changed(mediaId)`                                                                                                                                                     | books                                  | author followed; books/monitoring/files/downloads changed                                                                                |
| `music/added(artist, {search})` `music/changed(mediaId)`                                                                                                                                                     | music                                  | artist added; albums/tracks/monitoring/files/downloads changed                                                                           |
| `metadata/providers()`                                                                                                                                                                                       | metadata                               | a metadata provider registered or went away                                                                                              |
| `indexers/changed()` `indexers/rss(releases)`                                                                                                                                                                | indexers                               | indexer set changed; new RSS releases since last sync (`ReleaseInfo & {indexerName, indexerPriority}`)                                   |
| `downloads/grabbed(grab)` `downloads/updated(grab)` `downloads/completed(grab)` `downloads/failed(grab)` `downloads/clients()`                                                                               | downloads                              | grab sent; any state change; finished downloading (→ `import_pending`); failed (also when a user removes+blocklists); client set changed |
| `import/completed(item, grab, result)` `import/failed(item\|undefined, grab, reason)` `import/rejected(item, grab, reason, detail?)` `import/adapters()` `import/review()`                                   | import                                 | import done; failed; a guard refused it (download deleted + blocklisted); review adapters/sessions changed                               |
| `media/changed(change)`                                                                                                                                                                                      | import (`announceChange`)              | files added/removed in the library (`MediaChange`, §9.5); listeners are best-effort                                                      |
| `decision/families()`                                                                                                                                                                                        | decision                               | a quality family was added/removed                                                                                                       |
| `calendar/sources()` `calendar/changed()`                                                                                                                                                                    | calendar / kinds                       | sources changed; dates/states changed (open calendars reload)                                                                            |
| `history/added(event)`                                                                                                                                                                                       | history                                | an activity row was written                                                                                                              |
| `jobs/done(job)` `jobs/failed(job, error)`                                                                                                                                                                   | jobs                                   | a job finished / exhausted its attempts                                                                                                  |
| `notifications/changed()` `mediaservers/changed()` `settings/changed()` `health/changed()` `backup/changed()` `media-tools/changed()` `mediainfo/updated(fileId)` `verify/checked(result)` `theme/changed()` | respective plugins                     | console-refresh signals and status changes                                                                                               |
| `subtitles/changed()` `subtitles/action(mediaId, type, detail)`                                                                                                                                              | subtitles                              | `type` ∈ `subtitle-downloaded` `subtitle-upgraded` `subtitle-synced` `subtitle-failed`; history listens                                  |
| `webui/connection(client)`                                                                                                                                                                                   | webui (emitted _on_ the webui service) | a console socket connected/disconnected                                                                                                  |

Notification event _types_ (a different, string-typed vocabulary for `NotificationEvent.type`):
`media.imported`, `media.upgraded`, `import.failed`, `download.failed`, `download.grabbed`
(`EVENT_TYPES` in `plugins/notifications/src/index.ts`; providers also send `test`).

To add your own event: put it in your plugin's `declare module 'cordis' { interface Events }`,
namespace it `<plugin>/<what>`, keep it a no-payload "something changed" signal where possible so
console entries can just re-snapshot (see `plugins/history/src/console.ts`).

## 7. Jobs: persisted work

```ts
this.ctx.jobs.define<{ id?: number }>('podcasts.refresh', async (payload, { job, attempt, signal }) => { … },
  { maxAttempts: 5, retryDelayMs: 30_000 })           // handler for a type; lives with the calling plugin
this.ctx.jobs.enqueue('import.download', { grabId }, { dedupeKey: `import:${grabId}`, runAt, maxAttempts })
this.ctx.jobs.schedule('podcasts.refresh-all', 'podcasts.refresh', 60 * 60_000, payload?)  // interval schedule, persisted
```

- Jobs live in SQLite and survive restarts; a crash-orphaned `running` job is requeued at startup.
- A job only runs while a plugin that **defines** its type is loaded; otherwise it waits.
- Retries use exponential backoff; throwing = retry. `signal` aborts when the defining plugin is
  disposed (the job is requeued without spending an attempt).
- `dedupeKey`: at most one pending/running job per key. `schedule` also dedupes (`schedule:<name>`).
- Use `{ maxAttempts: 1 }` for sweeps that re-run on their own schedule.
- Config: `pollInterval` (1000 ms; `0` disables polling, tests call `ctx.jobs.tick()`), `concurrency`
  4, `maxAttempts` 5, `retryDelayMs` 30 s, `lockMs`, `retentionDays` 7.
- Existing job types you may enqueue: `indexers.rss`, `downloads.monitor`, `import.download`,
  `import.sweep`, `import.rescan`, `health.run`, `notifications.send`, `subtitles.*`,
  `<kind>.refresh`, `<kind>.wanted`, … (grep `jobs.define`).

## 8. The web console and REST API

### 8.1 Architecture

`@magpiejs/webui` is `@cordisjs/plugin-webui` with Magpie's own shell (no stock Cordis pages).
A plugin contributes to the console with an **entry**: a server half that publishes reactive data
and RPC methods, and a client bundle (`client/index.ts`) that registers pages, slots and regions
in the browser. `npm run build` builds the shell and each plugin's `client/index.ts` to
`plugins/<name>/dist`; `npm run dev` runs Vite with hot reload.

### 8.2 Server half: `ctx.webui.addEntry`

```ts
// src/console.ts, loaded via ctx.inject(['webui'], ctx => void ctx.plugin(console_, service))
export default function console_(ctx: Context, history: HistoryService) {
  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/history'], // client paths this entry serves (page paths)
      access: { view: 'library.read' }, // REQUIRED for non-admins, see below
    },
    { events: snapshot(), doThing: (id: number) => service.doThing(id) }, // data + RPC functions
  )
  ctx.on('history/added', () => entry.mutate((d) => void (d.events = snapshot()))) // push updates
}
```

- The second argument is the entry's **data**; plain values are reactive state, **functions are RPC
  methods** the client can call. `entry.mutate(d => { … })` sends a delta to subscribed clients.
- **`access` (`EntryAccess`)**: `view` (permission to receive data and the page), `call` (default
  `view`), `methods: { name: perm }` per-method overrides, `data: { key: perm }` keys withheld from
  callers lacking a permission (never sent, not in snapshots or deltas). **An entry with no `access`
  is `system.admin` only.** Settings pages use `settings.manage`; library pages `library.read`
  (reads) with write methods overridden to `library.write`.
- The server enforces access on every entry, delta and RPC call; client-side hiding is politeness.
- Throw from RPC methods with an `Error`; the message is shown to the user.

### 8.3 Client half: pages

```ts
// client/index.ts
import type { Context } from '@cordisjs/client'
import { registerPage } from '@magpiejs/console-kit/navigation'
export default function (ctx: Context) {
  registerPage(ctx, {
    path: '/catalog',
    name: 'Catalog',
    component: Catalog,
    order: 900,
    permission: 'library.read', // optional: hide for lacking users
    navigation: { group: 'library', icon: 'books', aliases: ['/item'], default: false },
  })
}
```

In a page component, `const data = useRpc<MyData>()` (from `@cordisjs/client`) gives the entry's
reactive data and callable methods (`data.value.events`, `await data.value.doThing(1)`).

Navigation (`@magpiejs/console-kit/navigation`):

- `group`: `library` | `activity` | `configuration` | `system` | `other`. `configuration`+`system`
  pages live inside **Settings**; the others in the primary nav. Metadata, not URL shape, decides.
- `icon` (shell SVG): `movies series podcasts books music calendar activity history settings other`.
- `order`: higher first, ties by page id. `default: true` marks the preferred landing page (primary
  and Settings resolved independently). `aliases`: extra route prefixes that highlight this page.
- Detail/add routes that shouldn't appear in nav: register through `ctx.client.router.page` with
  `disabled: () => true`. Enabled pages without metadata appear under Other.
- Settings routes follow `/settings/<name>`; System pages `/system/<name>`.

### 8.4 Slots and regions (extension points in the browser)

Slots are rendered with `<k-slot name="…" :data="{…}" />` and filled with
`ctx.client.router.slot({ type, component, order })`. Higher `order` first; `single` renders only
the top item. **These are all the slots that exist** (re-check with `grep -rn "k-slot" plugins/*/client`):

| Slot name                                                              | Rendered by                                                                          | Slot props (`data`)                                                                                                        | Filled by today                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `movie-detail`                                                         | movies `movie-detail.vue`                                                            | `{ movie }`                                                                                                                | history (100), mediainfo (90), subtitles   |
| `series-detail`                                                        | series `series-detail.vue`                                                           | `{ series }`                                                                                                               | history (100), mediainfo (90), subtitles   |
| `podcast-detail`                                                       | podcasts `podcast-detail.vue`                                                        | `{ podcast }`                                                                                                              | nothing yet                                |
| `activity-row`                                                         | downloads `activity.vue`                                                             | `{ grab }`                                                                                                                 | verify (`CheckBadge`, 10)                  |
| `provider-settings`                                                    | metadata, indexers, downloads clients, subtitles, notifications, media-servers pages | `{ kind, status?, test? }` where `kind` ∈ `metadata \| indexer \| download-client \| subtitle \| notifier \| media-server` | settings (the provider list/add/edit form) |
| `root`                                                                 | the shell                                                                            | `single`; engine-owned; **never register it**                                                                              | webui shell                                |
| `region:shell.topbar`, `region:shell.nav-foot`, `region:shell.notices` | shell                                                                                | none                                                                                                                       | auth Logout, settings link, offline notice |

There is **no** slot on book/author or music/artist/album detail pages yet; add one in the kind's
detail page (`<k-slot name="author-detail" :data="{ author }" />`) if you need it, and document it here.

Regions are simple widget areas: `registerRegion(ctx, 'shell.nav-foot', MyButton, { order: 10 })`
from `@magpiejs/console-kit/theme`. The theme decides where each region sits.

### 8.5 Auth, roles and permissions

`Permission` (`@magpiejs/types`): `account.self`, `library.read`, `library.write`,
`downloads.manage`, `settings.manage`, `system.admin`, `users.manage`.
Roles (`plugins/auth/src/permissions.ts`, fixed in code): **viewer** = `account.self`+`library.read`;
**manager** = viewer + `library.write`+`downloads.manage`; **admin** = all. API keys are `viewer` or
`manager` only, never admin, and never outrank their owner. Callers: a session cookie
(`magpie_session`; console and WebSocket) or `X-Api-Key` / `?apikey=` (only under `/api/`).
Plugins only _name_ the permission a route/entry needs: `ctx.auth.can(identity, permission)`.

Identity providers (login methods) are plugins that call
`ctx.auth.providers.register(provider)` in a `ctx.effect`: `IdentityProvider` =
`{ id, label, login?(view), setup?(view), authenticate?(req) → ExternalLogin, password?, knows?(userId) }`
(see `plugins/auth/src/providers.ts`, `docs/auth.md`, and `auth-local`/`auth-oidc`/`auth-proxy`).
They own their own routes under `/auth/<id>/`; auth owns users, roles, sessions and keys.

### 8.6 REST: `ctx.api`

```ts
ctx.api.get('/podcasts', () => podcasts.list())                       // GET needs library.read by default
ctx.api.post('/podcasts', async ({ body, query, params, identity }) => podcasts.add(body))  // others need library.write
ctx.api.as('downloads.manage').delete('/queue/:id', async ({ params, query }) => { … }) // name a permission
ctx.api.get('/podcasts/opml', () => new Response(xml, { headers: { 'content-type': 'text/x-opml' } }))
```

- Prefix `/api/v1`. Handlers return JSON-able data, `undefined` (→ 204), or a `Response`.
- Throw `ApiError(status, message)` (from `@magpiejs/api`) → `{ error }` with that status; anything
  else is a 500 (logged).
- Browser sessions must send `application/json` bodies (415 otherwise); API keys may not.
- Register routes in a child plugin under `ctx.inject(['api'], …)` so they go away with the service.
- Raw (non-API) routes use `ctx.server.get/post(...)` (`@cordisjs/plugin-server`, `path-to-regexp`
  params, not Koa); do not add a second HTTP server.

## 9. Building Magpie features

### 9.1 Which kind of plugin am I writing?

| I want to…                                       | Write a…                    | Register with                                            |
| ------------------------------------------------ | --------------------------- | -------------------------------------------------------- |
| support a new indexer type                       | indexer provider            | `ctx.indexers.register(provider, options)`               |
| support a new download client                    | download client             | `ctx.downloads.register(client, options)`                |
| add a metadata source                            | metadata provider           | `ctx.metadata.register(provider)`                        |
| add a subtitle source                            | subtitle provider           | `ctx.subtitles.register(provider)`                       |
| send notifications somewhere                     | notifier                    | `ctx.notifications.register(notifier, { name })`         |
| refresh a media server after imports             | media-server provider       | `ctx.mediaServers.register(provider, options)`           |
| add a login method                               | identity provider           | `ctx.auth.providers.register(provider)` (§8.5)           |
| change how the console looks                     | theme                       | `ctx.theme.register(def)` + client `registerTheme` (§10) |
| add a new kind of media (audio courses, comics…) | kind plugin                 | §9.4                                                     |
| reject bad downloads                             | import guard / verify check | `ctx.import.guard(fn)` / `ctx.verify.check(name, fn)`    |
| add a rule to release decisions                  | decision rule               | `ctx.decision.rule(name, fn)`                            |
| report health                                    | health check                | `ctx.health.check(name, fn, opts)`                       |
| show dates on the calendar                       | calendar source             | `ctx.calendar.source(kind, fn)`                          |

### 9.2 Library model

`ctx.library` owns `library_media_items` (id, kind, title, sortTitle, year, status, monitored,
externalIds, rootFolderId, `folder`, profileId, addedAt…), `media_files` (path **relative to the
item's folder**, size, quality, formatScore, release info, `targetId`), `alternate_titles`,
`root_folders`, `targets` (extra _versions_ of an item, e.g. a 4K copy; the item's own profile is
the primary target; see `docs/multi-version-targets.md`) and settings (naming, file handling).
Key calls: `add`, `update`, `remove`, `get`, `list(kind?)`, `findByTitle`, `folderOf(item)`,
`files(mediaId, targetId?)`, `addFile`, `updateFile`, `removeFile`, `targets/addTarget/…`,
`rootFolders(kind?)`, `naming(kind)`, `fileHandling()` (`useHardlinks`, `recycleBin`),
`registerKind`, `registerNaming`, plus helpers `renderName(template, values)`, `cleanFileName`.
Kind-specific data lives in **your** plugin's tables, keyed by `media_id → library_media_items`.

Naming: `NamingScheme = { templates: Record<key, {label, default, help?}>, tokens: string[] }`.
`renderName` resolves `{Token}` **case-insensitively** and supports `{season:00}` padding, so
`registerNaming` throws if two tokens differ only by case (that was a real silent bug; use e.g.
`{Disc Prefix}` not `{Disc}` next to `{disc:0}`).

Also `ExternalIds` keys (`tmdb tvdb imdb anidb mal itunes openlibrary musicbrainz`); extend the
interface in `@magpiejs/types` if your kind needs another.

### 9.3 Decisions, qualities and profiles

A **quality family** (`ctx.decision.family(def)`) supplies, for a kind: ordered `qualities`
(worst→best, ids unique across all families), `parse(title, hint)` returning a `BaseParsed`
(`{input, title, kind, revision, languages, group?, flags}` plus your fields), `qualityOf(parsed)`,
`sizeRule: 'perMinute' | 'total' | 'none'`, `defaultSizes`, `defaultProfiles` (seeded the first
time the family is seen; **profile names must be unique within a family**, and the same names in
different families are fine), optional `conditions` (custom-format conditions only your family
understands) and `rules`. Built in: `video` (movies, series). Others: `podcast`, `ebook`,
`audiobook`, `audio`. Helper `profileItems(qualities, allowedIds, groups?)`.

Evaluation: `decision.evaluate/evaluateAll/evaluator(target)` where
`DecisionTarget = { kind, mediaId?, targetId?, profileId, runtimeMinutes?, originalLanguage?, episodes?, unitIds?, current? }`
returns `Decision { accepted, quality, formatScore, matchedFormats, rejections[{rule, reason, permanent}], rank[], parsed }`;
sort with `compareDecisions`. Rule order: built-in generic rules → the family's rules → rules added
via `ctx.decision.rule(name, rule)`. A `Rule(ctx: RuleContext)` returns `undefined` (accept),
a reason string, or `{ reason, permanent? }`. Useful: `isBetter`, `cutoffMet`, `profileRanks`.
`downloads` already adds rules `blocklist` and `in-queue`. `decision.qualityName(id)` for display.

### 9.4 Recipe: a new kind of media (no edits to core plugins)

Proven by `packages/app/tests/fixture-kind.test.ts`, which defines a whole "notes" kind in one file.
Steps (see `plugins/podcasts` (simplest), `plugins/music`, `plugins/books`):

1. **Type the kind:** `declare module '@magpiejs/types' { interface MediaKinds { mykind: true } }`
   (declaration merging; `MediaKind` becomes a union).
2. **Own your data:** tables `<ns>_details` (`media_id` pk → `library_media_items`, `onDelete cascade`)
   and per-part tables; `ctx.database.register(...)`.
3. **Register in `[Service.init]`:**
   `ctx.library.registerKind({ id, label, browse?: { addPath, detailPath } })`,
   `ctx.library.registerNaming(kind, scheme)`,
   `ctx.decision.family(family)`.
4. **Optional integrations, each in a child plugin under `ctx.inject`:**
   - `['indexers']` → `ctx.indexers.searchType(kind, { mode, ids?, fields?, defaultCategories })`
     (`mode` ∈ `search movie tvsearch music book`; Torznab categories are per kind, per indexer
     overridable via config).
   - `['import']` → `ctx.import.register(kind, importer, { extensions })`; an `Importer` is
     `(item, grab, tools) => ImportResult`. Use `tools.files()`, `tools.place(src, dest)`
     (hardlink/copy for torrents, move for usenet/http), `tools.recycle`, `tools.isUpgrade`; throw
     `ImportError` for user-visible final failures (non-`ImportError` throws are retried by the job).
   - `['calendar']` → `ctx.calendar.source(kind, (from, to, now) => CalendarEntry[])`
     (`entryState(date, {hasFile, monitored}, now)` helper).
   - `['downloads']` → grabbing: `ctx.downloads.grab(mediaId, release, { quality, formatScore, unitIds, targetId?, manual? })`.
   - `['api']` → REST under `/api/v1/<kind>`; `['webui']` → pages (§8).
   - `['verify']` → `ctx.verify.runtime(item => minutes)` if you can say how long an item runs.
5. **Items with parts** (episodes, books, albums): use `@magpiejs/units`.
   `unitSearch(ctx, spec)` (you supply `queries`, `parse`, `matcher`, `target`) and
   `unitAutomation(ctx, spec)` (search on add, retry after failed download, daily wanted sweep, RSS
   matching) give you the shared search/grab/automation loop; downloads' generic
   `downloads_grab_units` table links grabs to parts (`GrabOptions.unitIds`, `activeFor`, `unitsOf`).
6. **Metadata:** if no existing provider fits, add a provider plugin (§9.5) with new optional
   methods on `MetadataProvider` (as `getAuthor/getBooks/getArtist/getAlbums/getTracks` were added).
7. Add a quality profile row if your kind has no real qualities (podcasts use a one-quality family
   because every library item needs a profile).
8. Add to `defaultConfig` in `packages/app/src/index.ts` + `packages/app/package.json`; write an
   exit test like `plugins/music/tests/exit.test.ts` (search → grab → import → upgrade).

### 9.5 Provider contracts (`packages/types/src/index.ts`)

```ts
interface MetadataProvider { id; kinds: MediaKind[]; discoveryFeeds?; discover?(feedId, region);
  search(query); getMovie?; getSeries?; getEpisodes?(id, ordering?); orderings?; mapIds?;
  getAuthor?; getBooks?; getArtist?; getAlbums?; getTracks? }
interface IndexerProvider { id; protocol: 'torrent'|'usenet'|'http'; capabilities(); search(ReleaseQuery);
  rss?(); test(): Promise<TestResult> }                                    // + IndexerOptions: {name, priority, enableRss, enableAutomatic, enableInteractive}
interface DownloadClient { id; protocol; add(payload: DownloadPayload, {category?, paused?}): Promise<downloadId>;
  list(): Promise<DownloadStatus[]>; remove(downloadId, deleteData); test() }   // + ClientOptions: {name, priority, category}
interface Notifier { id; events: string[]; send(event, { signal?, deliveryId? }); test() }
interface SubtitleProvider { id; name; priority; automatic; search(ctx, requirement, signal);
  download(candidate, signal): Promise<Uint8Array>; test(signal): Promise<string> }   // errors: SubtitleProviderError(code, msg, retryAt?)
interface MediaServerProvider { id; test(); libraries(signal?); refresh(paths: ChangedPath[], {signal?}) } // + options {name, kinds, mappings, debounceMs}
```

Facts to respect:

- `DownloadPayload` is `magnet | torrent | nzb | url`; the downloads plugin resolves the release URL
  for you. `DownloadStatus.state` ∈ `queued downloading stalled completed failed paused`;
  `downloadId` is the lowercase info hash, usenet job id, or the client's own id. `outputPath` is
  as the client sees it (path mapping converts it).
- `Protocol` = `torrent | usenet | http`.
- A provider is a function plugin with a `Config` schema, a unique stable `id` (§3.5), `test()`
  returning `{ ok, message? }`, and registration via the registry's method inside `apply`.
  Reference implementations: indexer `plugins/indexer-torznab`, clients `downloader-qbittorrent`,
  `-transmission`, `-deluge`, `-http`; metadata `metadata-tmdb`, `-itunes`, `-openlibrary`,
  `-musicbrainz`; notifiers `notifier-webhook`, `-discord`, `-ntfy`, `-email` (shared helpers
  `@magpiejs/notifications/config` and `/transport`: `eventConfig`, `eventsOf`, `checkUrl`, `post`);
  media servers `media-server-plex|jellyfin|emby` (shared `config.ts`); subtitles
  `subtitles-opensubtitles`, `-subdl` (`@magpiejs/subtitles/transport`).
- Notifier `events` come from the `onImported/onUpgraded/onFailed/onGrabbed` config helpers.
  Never put local file paths or credentials in `NotificationEvent.data`; errors shown to users
  go through `sanitize` (no URLs).
- Indexer search: `ReleaseQuery { kind, term?, ids?, season?, episode?, fields? }`, the indexer maps it
  using `ctx.indexers.searchTypeOf(kind)`. Failures inside an indexer are reported, not thrown;
  `IndexersService` backs off 5 min → 15 → 30 → 60 → 180 → 360 after consecutive failures.
- Per-host rate limits for external APIs (MusicBrainz is 1 req/s); use `@magpiejs/http-utils`.
- Metadata for a kind is found with `ctx.metadata.for(kind, preferredId?)`; discovery feeds feed
  `@magpiejs/browse`, intersected with registered kinds that declare `browse`.

### 9.6 The grab → import pipeline (so you know what your plugin plugs into)

`wanted → grabbed → queued/downloading (stalled/paused) → import_pending → importing → imported`,
with `failed` and `import_failed` (`GrabState` in `plugins/downloads/src/schema.ts`; persisted in
`downloads_grabs.state`, so the pipeline survives restarts).

1. A kind searches (`indexers.search` / RSS via `indexers/rss`), runs `decision.evaluate*`, and
   calls `downloads.grab(...)`; `downloads/grabbed` fires.
2. The monitor job polls every client (default 60 s), reconciles `grabs`, marks stalled/failed,
   and emits `downloads/updated`; on completion `downloads/completed`.
3. `import` enqueues `import.download` (deduped), runs **guards** once on first file listing
   (`ImportGuard(input) ⇒ throw ImportRejected` → download deleted, release blocklisted, next-best
   searched), then the kind's `Importer`; emits `import/completed` and `media/changed`.
   `MediaChange = { origin: 'download'|'manual', item, added[], removed[], replaced, release?, version? }`.
4. Failed → `downloads/failed` → blocklist → kind automation searches again.
5. History, notifications, media-server refresh, subtitles and mediainfo all listen to these events;
   none is called directly by the pipeline.

Manual import and library adoption use `ctx.import.review.register(kind, ReviewAdapter)` (currently
only `'movie' | 'series'`; see `docs/library-import.md`).

### 9.7 Health, verify, backup

- `ctx.health.check(name, async (signal) => ({ level: 'ok'|'warning'|'error', message, details? }), { label, description, link })`
  runs every 15 min and on demand; a throw/timeout = error. Checks only report. `link` is the
  console page that fixes it. Register the check only when its service exists
  (`ctx.inject([...])`).
- `ctx.verify.check(name, (c: CheckContext) => Problem[] | Promise<Problem[]>, { mode, needsProbe, label, description })`
  inspects a finished download before import (fakes, executables, bad durations).
- Backups are zips of the DB (+ `magpie.yml`); a restore is staged and applied at next start
  (`applyStagedConfig` / `applyStagedDatabase` in `@magpiejs/database`).

## 10. Themes

A theme is a plugin `theme-<name>` with a server half (`ctx.theme.register({ id, name, description?,
extends?, apiVersion: 1, swatch? })` plus `ctx.webui.addEntry({... access: { view: 'account.self' } })`
so everyone gets it) and a client half (`registerTheme(ctx, { id, styles?, parts? })` from
`@magpiejs/console-kit/theme`). Parts: `shell`, `settings.layout`, `media.list`, `media.detail`,
`media.add` (props/slots of `MediaCardGrid`, `MediaDetailShell`, `AddMediaFlow` in
`packages/console-kit/src/defaults/`). Styles go in the `theme` cascade layer; override `--mp-*`
custom properties and `.mp-*` classes. A part that throws is dropped and the next theme in the
`extends` chain renders; `?theme=default` shows the built-in. Keep the `data-testid`s of built-ins.
Full guide: `docs/theme-authoring.md`; design: `docs/themes.md`. Kind plugins that want themed
lists/details/add pages use `@magpiejs/console-kit/MediaCardGrid.vue`, `MediaDetailShell.vue`,
`AddMediaFlow.vue` (the themed wrappers), not the `defaults/` ones.

Shared console components in `@magpiejs/console-kit`: `ReleasePicker`, `DownloadProgress`,
`NavLink`, `LocationNotice`, `TabBar`, `CollapsibleSection`, `SearchBox`, `LookupResult`,
`ProfileFolderFields`, plus helpers in `src/status.ts` (`ReleaseRow`, `fileSize`,
`downloadStatus`, `Badge`) and `access.ts` (`can(permission)`, `caller`).
Use the shell's `mp-*` CSS classes (`mp-head`, `mp-lead`, `mp-card`, `mp-table`, `mp-badge`, `mp-empty`,
`mp-row`, `mp-small`, `mp-muted`, `mp-error`) rather than inventing styles.

## 11. Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type`, and
  `import type {} from '@x'` for typing-only side effects). ESM; no CommonJS.
- Match surrounding code: comment density (header comment explaining the plugin's purpose, `/** */`
  on public API), naming, Prettier style (`npm run format`).
- Services are `Service` classes named `<Thing>Service`; default-export the class.
- Prefer small "something changed" events + re-snapshot over fine-grained payloads for the console.
- Never swallow errors silently; log with `ctx.logger.warn`, surface user-fixable ones in the UI.
- User-facing strings are plain, short English; no jargon like "loader entry"; users never see raw
  Cordis names or YAML.
- Secrets: schema `role('secret')`; never logged, never returned to the console, never in
  notification data.
- Paths: library file paths are stored relative to the item's folder; use `folderOf(item)` to
  resolve; never trust client-reported paths (check `contained()`/path-mapping, see import review).
- Don't add dependencies lightly; check the license (MIT-compatible only).

## 12. Testing

Vitest, forks pool; `plugins/*/tests/**/*.test.ts` and `packages/*/tests/**/*.test.ts`.
`@magpiejs/testing`:

- `createTestContext({ db?, pollInterval?, metadata?, calendar? })` boots Timer, HTTP, in-memory
  database, Jobs (polling off; call `ctx.jobs.tick()`), Decision, Library, Metadata, Indexers,
  Downloads, Import and Calendar. Then `await ctx.plugin(YourKind)`.
- `fakeTorznab(...)` (a fake indexer server), `fakeDownloadClient(...)`, `finishDownloads(...)`.
- Use temp dirs (`mkdtempSync`) for filesystem imports; clean up in `afterAll`.
- Exit-style tests drive a feature end to end (search → grab → import → calendar/upgrade) with fakes
  rather than mocking internals: copy `packages/app/tests/fixture-kind.test.ts`,
  `plugins/music/tests/exit.test.ts`, `plugins/books/tests/exit.test.ts`.
- Parsers use golden fixtures (`tests/fixtures/*.yml`, `tests/corpus`); every decision rule has a table test.
- HTTP providers: recorded fixtures/fakes; live-service tests are opt-in only.
- `Service` fields like `now` and `timeout` are overridable for deterministic tests.

## 13. Commands and CI

```sh
npm install
npm run dev                 # console at http://localhost:6767 (config dir ./data, --config / MAGPIE_CONFIG_DIR)
npm run build && npm start  # production console (builds shell + every plugin's client entry)
npm run typecheck           # tsc -p tsconfig.json
npm run lint                # eslint .
npm run format:check        # prettier --check (npm run format to fix)
npm run check:ownership     # migrations only touch their plugin's tables
npm test                    # vitest run
npm run db:generate -w @magpiejs/<name>   # after schema changes
```

CI (`.github/workflows/ci.yml`, Node 24) runs, in order: typecheck, lint, format:check,
check:ownership, test, build. **All must pass.** Run the same before you finish. Prove a fix by
reproducing the failure first, then showing the passing check. Never skip, disable or quarantine a
test to get green.

Dev notes: `@cordisjs/plugin-hmr` and `plugin-logger` aren't used (dev restarts via `packages/app/src/dev.ts` (not `tsx watch`, which loops on Vite's temp config file);
Cordis 4's built-in logger is attached in `packages/app`). The console builds with Vite 7;
Vitest uses Vite 8. A client entry is rebuilt per plugin by `scripts/build-webui.ts`; the `import`
plugin needs `build: { manifest: false }` (special-cased there).

## 14. Pick a template to copy

| Building                            | Copy                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Feature service with a table + page | `plugins/history` (smallest), `plugins/notifications` (jobs, registry, console)   |
| Registry that providers plug into   | `plugins/metadata` (smallest), `plugins/indexers`, `plugins/health`               |
| Kind of media                       | `plugins/podcasts` (smallest), `plugins/music`, `plugins/books`, `plugins/movies` |
| Item-with-parts kind                | `plugins/series`, `plugins/books`, `plugins/music` + `packages/units`             |
| Indexer / download client           | `plugins/indexer-torznab`; `plugins/downloader-qbittorrent` / `-http`             |
| Metadata provider                   | `plugins/metadata-itunes` (simplest), `-tmdb`, `-musicbrainz`                     |
| Notifier                            | `plugins/notifier-webhook`, `-ntfy`                                               |
| Subtitle provider / media server    | `plugins/subtitles-opensubtitles`; `plugins/media-server-plex`                    |
| Identity provider                   | `plugins/auth-proxy` (smallest), `auth-local`, `auth-oidc`                        |
| Console-only page                   | `plugins/system`, `plugins/calendar`, `plugins/browse`                            |
| Theme                               | `plugins/theme-slate` (CSS only), `plugins/theme-dock` (shell + parts)            |
| Import guard / post-download check  | `plugins/verify`                                                                  |
| Per-file derived data               | `plugins/mediainfo`                                                               |

## 15. Checklist before you open a change

- [ ] I read the nearest existing plugin and the owner of every registry/event I use.
- [ ] Package name `@magpiejs/<name>`, `magpie.namespace` (if tables), `magpie.provider` (if a provider with a `Config` export).
- [ ] Hard deps in `inject`; everything optional behind `ctx.inject([...], …)`.
- [ ] Every registration goes through `ctx.effect` / a registry method / a child plugin, so disabling removes it.
- [ ] Tables prefixed with my namespace; foreign keys with deliberate `onDelete`; migrations generated
      and committed; no released migration edited; `npm run check:ownership` passes.
- [ ] Console entry has an `access` and per-method permissions where writes exist; REST routes name a
      permission when it isn't the default.
- [ ] New events declared in `declare module 'cordis'`; new slots/regions/services documented in this file.
- [ ] Added to `defaultConfig` + `packages/app/package.json` if it ships enabled.
- [ ] Tests added in the style of §12; typecheck, lint, format, ownership, tests and build all pass.
- [ ] No GPL-derived code or fixtures.

## 16. Documentation index (`docs/`)

| Doc                                         | Read it for                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `PLAN.md`                                   | architecture, table ownership rule (§3.0.1), data model, flows, phases   |
| `phase-2.md`                                | parser and decision-engine design                                        |
| `phase-3.md`, `phase-4.md`                  | movies, TV end to end, settings/providers                                |
| `phase-4.5.md`                              | generic media kinds: families, search types, naming, import by extension |
| `auth.md`                                   | roles, permissions, identity providers, API keys                         |
| `themes.md`, `theme-authoring.md`           | theme engine, parts, regions, writing a theme                            |
| `ui-cleanup.md`                             | provider-settings slot and console conventions                           |
| `notifications-media-refresh.md`            | notifiers and media-server refresh                                       |
| `health-and-backups.md`                     | health checks, backups, restore                                          |
| `library-import.md`, `phase-5-migration.md` | adoption/manual import, migrating from \*arr                             |
| `multi-version-targets.md`                  | extra versions of an item (targets)                                      |
| `media-info.md`, `post-download-checks.md`  | mediainfo and the verify guard                                           |
| `phase-7-subtitles.md`                      | subtitles design                                                         |
| `request-app-compatibility.md`              | `/api/v3` shim for Seerr/Overseerr                                       |

When you add a service, event, slot, region, provider kind or permission, **update §3–§10 of this
file** and, if it needs more than a paragraph, add a doc and link it in §16.
