# Plugin browser, install and management (Magpie plugins only)

Status: proposal. Nothing here is built.

## Goal

From **Settings → Plugins** a user can see every Magpie plugin, browse a catalog of ones
they don't have, install one, add and configure instances of it, update it, and remove it.
No YAML, no shell, no Cordis names in the UI (same rule as PLAN.md §3.1).

## Scope

In:

- `@magpiejs/*` plugins and third-party plugins that follow the Magpie plugin contract below.
- **Provider plugins** (indexer, download-client, metadata, subtitle, notifier, media-server):
  the kinds `plugins/settings` already understands via `package.json → magpie.provider`.
- Toggling built-in feature plugins (movies, podcasts, books, …) on and off.

Out:

- Arbitrary Cordis plugins and `@cordisjs/plugin-market` (PLAN.md §1 rules these out).
- Third-party plugins that ship their own console pages (see "Phasing", phase 4).
- Third-party plugins that add database tables. Providers only talk to host services.

## What exists today

- `plugins/settings` scans its sibling directories (`plugins/*`) for a `package.json` with
  `magpie.provider`, imports the package's `Config` schema, renders a form from it
  (`fields.ts`), and adds/updates/removes entries in `magpie.yml` through the loader tree
  (`tree.create/update/remove`). That hot-loads one plugin.
- `defaultConfig()` in `packages/app/src/index.ts` is the list of built-in plugins.
- Plugins are npm workspaces and export TypeScript source (`"exports": "./src/index.ts"`),
  run through `tsx`.
- The loader is created with `baseUrl: import.meta.url` of the app, so plugin names
  resolve from Magpie's own `node_modules`, never from the config directory.
- PLAN.md already reserves `<config>/plugins/` for user-installed plugins.

These give us the "add an instance" half. The missing half is getting new packages onto
disk, safely, and describing them before they are loaded.

## Constraints that shape the design

1. **Discovery is hard-wired to workspace siblings.** It has to read from a second
   directory (`<config>/plugins/node_modules`) and from the built-in set.
2. **Installed plugins must ship compiled JS.** Built-ins export `.ts`; we don't want to rely
   on `tsx` transforming code under `node_modules`. The contract requires an `exports` entry
   pointing at JS.
3. **Plugin UI is built at Magpie build time** (`scripts/build-webui.ts`, `addEntry` with
   a `manifest.json`). An installed plugin can't add Vue pages at runtime in v1. Provider
   plugins don't need to: their form is generated from the schemastery `Config`.
4. **Installing means running third-party code in the Magpie process**, which holds the
   database, API keys in `magpie.yml`, and library write access. That is the main risk.
5. **ESM modules can't be unloaded.** A new plugin can be hot-loaded. Updating or
   uninstalling code that is already imported needs a restart (or cache-busted imports).
6. `cordis`, `@magpiejs/types` and `schemastery` must resolve to the host's copies, never a
   second copy inside the plugin's own `node_modules`, or `instanceof`/service injection
   breaks.

## Plugin contract

Extend the existing `magpie` block in `package.json`:

```jsonc
{
  "name": "magpie-indexer-foo",
  "version": "1.2.0",
  "keywords": ["magpie-plugin"],
  "exports": { ".": "./dist/index.js" },
  "peerDependencies": { "cordis": "4.0.0-rc.10" },
  "magpie": {
    "apiVersion": 1, // bumped when @magpiejs/types provider contracts break
    "provider": { "kind": "indexer", "label": "Foo", "basic": ["name", "url"] },
    "needs": ["@magpiejs/indexers"], // host services it injects
    "network": ["api.foo.example"], // hosts it talks to, shown on the install dialog
    "homepage": "https://…",
  },
}
```

Checks at install and at load: `apiVersion` is supported, `needs` plugins are present,
`provider.kind` is known, `Config` exports a schema, JS entry exists. A failure keeps the
plugin out of the picker and shows the reason in **Installed**.

## Components

### 1. `@magpiejs/plugins` (new plugin, owns the feature)

Own plugin so settings stays "edit entries" and this owns "packages". It declares what it
owns per `scripts/check-ownership.ts`.

```ts
interface PluginsService {
  catalog(query?: string): Promise<CatalogItem[]> // registry + local state merged
  installed(): InstalledPlugin[] // built-in + user-installed
  install(name: string, version: string): Promise<JobId>
  update(name: string, version: string): Promise<JobId>
  uninstall(name: string, opts: { removeEntries: boolean }): Promise<void>
  setFeature(name: string, enabled: boolean): Promise<void> // built-in feature toggle
}
```

Events: `plugins/changed`, `plugins/restart-required`. Long operations run as a job
(`@magpiejs/jobs`) so the page can show progress and survive a reload.

### 2. Catalog (the "browser")

Recommended: a **curated static index**, `registry.json`, in a Magpie-owned GitHub repo
and served over HTTPS (fetched with `@cordisjs/plugin-http`, cached in `<config>/cache/`):

```jsonc
{
  "apiVersion": 1,
  "plugins": [
    {
      "name": "magpie-indexer-foo",
      "kind": "indexer",
      "label": "Foo",
      "summary": "…",
      "author": "…",
      "homepage": "…",
      "versions": [
        { "version": "1.2.0", "apiVersion": 1, "integrity": "sha512-…", "min": "0.5.0" },
      ],
    },
  ],
}
```

- Curated means a human reviewed it, and `integrity` pins the exact tarball so a
  compromised npm publish can't reach users.
- Fallback for power users: **Install by package name** (behind an "unverified" warning),
  which resolves via the npm registry and requires the `magpie-plugin` keyword.
- Offline or fetch failure: the Browse tab shows the last cache and a notice. Built-ins
  and installed plugins always work.
- Rejected alternative: browse npm search directly. No review, no pinning, no compat data.

### 3. Installer

A private project at `<config>/plugins/` with its own `package.json` and lockfile:

```
<config>/plugins/
  package.json          # { "private": true, "dependencies": { …exact versions… } }
  package-lock.json
  node_modules/
```

- Run `npm install <name>@<version> --ignore-scripts --omit=peer --save-exact` as a child
  process with cwd `<config>/plugins/`. **Never run install scripts.**
- Verify the tarball integrity against the registry entry before the install is accepted.
- Resolution: the discovery step imports from that directory by absolute `file:` URL, and
  peers resolve to the host because they aren't installed there. Verify that
  `tree.import(...)` in the loader accepts this; if not, register a resolve hook
  (`module.register`) scoped to that directory. **Open question, spike first.**
- Docker/bare-metal: the config dir is already the persistent volume, so installs survive
  upgrades. On a Magpie upgrade, re-validate `apiVersion` of every installed plugin and
  disable incompatible ones instead of failing startup.

### 4. Lifecycle

| Action              | Steps                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install             | consent dialog → job: npm install → validate contract → import `Config` → provider appears in the picker. **Hot, no restart.** Nothing runs until the user adds an instance.                                            |
| Add instance        | existing `settings.add` flow, unchanged                                                                                                                                                                                 |
| Update              | snapshot `<config>/plugins/package*.json` and `magpie.yml` → disable its entries → npm install → validate → mark `restart-required` → on restart entries re-enabled. On validate failure restore the snapshot.          |
| Uninstall           | block while entries exist, or `removeEntries: true` after a confirm that lists them → remove entries → `npm uninstall` → `restart-required` to drop code from memory. Data written by the plugin is never auto-deleted. |
| Disable / enable    | existing entry toggle                                                                                                                                                                                                   |
| Built-in feature    | toggle its `magpie.yml` entry; refuse if an enabled plugin lists it in `needs`                                                                                                                                          |
| Failed load at boot | entry stays in `magpie.yml`, shown as **Failed** with the error, and surfaced in the health plugin. Magpie still starts.                                                                                                |

Restart: Magpie has no self-restart today (`cli.ts` only handles shutdown). Add a
`system` endpoint that exits with a dedicated code and document the requirement for a
supervisor (Docker restart policy, systemd). Without one, the banner says "restart Magpie".

## UI: Settings → Plugins

Tabs (follow `docs/ui-cleanup.md` language: no Cordis terms):

- **Browse**: search, kind filter, cards (label, summary, author, version, "Built in" /
  "Installed" / "Install"). Detail drawer shows what it talks to (`network`), what it
  needs, changelog link, and the install consent text.
- **Installed**: built-in and user-installed in one list with state chips: _Active_
  (n instances), _Not set up_, _Update available_, _Incompatible_, _Failed_. Row actions:
  Add instance (jumps to the existing provider settings slot), Update, Remove.
- **Features**: toggles for built-in feature plugins with dependency warnings.
- Global banner: "Restart required" while `plugins/restart-required` is pending.

Admin-only (reuse `@magpiejs/auth`). The page is a client entry of `@magpiejs/plugins`,
built with the rest of the web console.

## Security

- Admin role required for every mutating call; CSRF same as other API routes.
- Consent dialog states plainly: _this plugin runs inside Magpie and can read your
  library, settings and API keys_. Curated vs unverified is a visible badge.
- `--ignore-scripts`, exact versions, integrity pinning, scoped to `<config>/plugins/`.
- Plugin API keys stay secret-masked (existing `secrets` handling in settings).
- Honest limit: Node gives no in-process sandbox. The `network` list is disclosure, not
  enforcement. Don't promise isolation; the curated registry is the real control.
  A worker-thread or child-process host is a possible later hardening.

## Phasing

1. **Contract and local manager.** Add `apiVersion/needs/network` to the existing
   providers. New `@magpiejs/plugins` with **Installed** and **Features** tabs only (built-ins).
   No installer. Moves the "which providers exist" view out of per-page lists.
2. **Install from a local tarball / by name** into `<config>/plugins/`, second discovery
   directory, the loader resolution spike, hot-load. Behind an "advanced" switch.
3. **Catalog.** `registry.json`, Browse tab, integrity pinning, curated badge, cache.
4. **Update, uninstall, rollback, restart endpoint, health integration.**
5. **Later, optional:** prebuilt client bundles for plugins with their own pages (needs a
   runtime `addEntry` from a package-provided `dist/manifest.json`), and process isolation.

Phases 1 and 4 are the likely cut line if only part gets built.

## Testing

- Unit: contract validation, registry parsing, version/`apiVersion` compat.
- Integration with `packages/testing`: a fixture plugin as a local tarball, installed into a
  temp config dir, then assert: it appears in `providers()`, `settings.add` works,
  uninstall is blocked while an entry exists, a bad integrity hash is refused, an
  incompatible `apiVersion` is listed as Incompatible and not loaded.
- npm is stubbed with `file:` tarballs so tests need no network.

## Open questions

1. Who hosts and reviews the registry, and what is the submission process?
2. Does `tree.import` / the loader resolve packages outside the app's `node_modules`, or do
   we need a resolve hook? (spike in phase 2)
3. Is a self-restart endpoint acceptable, or do we only show a "restart manually" banner?
4. Should providers be allowed to ship a client bundle at all, given the web console is
   built ahead of time?
