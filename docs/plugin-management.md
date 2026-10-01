# Plugin browser and management (Magpie plugins only)

Status: proposal. Nothing here is built.

## Goal

From **Settings → Plugins** a user can see every plugin that ships with Magpie, see which
are active, add and configure instances of provider plugins, and turn built-in features
on and off. No YAML, no shell, no Cordis names in the UI (same rule as PLAN.md §3.1).

## Scope

**This proposal does not change how plugins are installed, and adds no user installs.**
Plugins stay npm workspaces under `plugins/*`, exported as TypeScript source and listed in
`defaultConfig()`. There is no installer, no registry, no `<config>/plugins/` directory, no
third-party code, and no change to how the loader resolves packages.

In:

- Listing the built-in `@magpiejs/*` plugins with their state.
- **Provider plugins** (indexer, download-client, metadata, subtitle, notifier, media-server):
  the kinds `plugins/settings` already understands via `package.json → magpie.provider`.
- Toggling built-in feature plugins (movies, podcasts, books, …) on and off.

Out (see "Deferred: user installs"):

- Installing, updating or removing packages. Third-party plugins. A catalog or registry.
- Arbitrary Cordis plugins and `@cordisjs/plugin-market` (PLAN.md §1 rules these out).
- Changes to `defaultConfig()` defaults, `package.json` `exports`, or the web console build.

## What exists today

- `plugins/settings` scans its sibling directories (`plugins/*`) for a `package.json` with
  `magpie.provider`, imports the package's `Config` schema, renders a form from it
  (`fields.ts`), and adds/updates/removes entries in `magpie.yml` through the loader tree
  (`tree.create/update/remove`). That hot-loads one plugin.
- Provider forms appear on the per-kind pages (Indexers, Download clients, Metadata,
  Subtitles) through the `provider-settings` slot. Notifiers and media servers may have their
  own pages; to confirm.
- `defaultConfig()` in `packages/app/src/index.ts` is the list of built-in plugins.

So "add an instance" already works. What's missing is one place that shows all plugins and
their state, and a way to switch features on and off without editing `magpie.yml`.

## Design

### `@magpiejs/plugins` (new plugin, owns the feature)

Own plugin so settings stays "edit entries". It declares what it owns per
`scripts/check-ownership.ts`. It only reads existing information and calls existing
loader/settings APIs.

```ts
interface PluginsService {
  list(): PluginInfo[] // every built-in plugin with kind, label, state
  setFeature(name: string, enabled: boolean): Promise<void> // toggle a feature entry
}

interface PluginInfo {
  name: string // package name
  label: string
  kind: ProviderKind | 'feature'
  state: 'active' | 'not-set-up' | 'disabled' | 'failed'
  instances: number // provider entries in magpie.yml
  needs: string[] // plugins it depends on
  error?: string
}
```

Event: `plugins/changed` (mirrors `settings/changed` plus feature toggles).

Where the data comes from:

- **Providers:** `settings.providers()` and `settings.entries()`. No new discovery.
- **Features:** the entries in `magpie.yml` that aren't providers, read from the loader
  tree the same way `settings` does.
- **Dependencies:** a small optional `magpie.needs: ["@magpiejs/indexers"]` in each
  plugin's `package.json`, next to the existing `magpie.provider` block. Plugins without it
  are treated as having no dependants, and the toggle warns only when it knows. This is a
  metadata addition only; it doesn't change how a plugin loads.
- **Failures:** the loader's per-entry error state, shown with the message. Feeds the
  existing health plugin rather than adding a new check mechanism.

### Lifecycle (existing mechanisms only)

| Action              | How                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Add instance        | existing `settings.add`, unchanged                                                          |
| Edit / disable      | existing `settings.update`, unchanged                                                       |
| Remove instance     | existing `settings.remove`, unchanged                                                       |
| Toggle feature      | set or clear `disabled` on its loader entry; refuse if an enabled plugin's `needs` lists it |
| Failed load at boot | entry stays in `magpie.yml`, shown as **Failed** with the error. Magpie still starts        |

Disabling a feature never deletes its data (PLAN.md: removal only after a backup,
never automatic).

## UI: Settings → Plugins

Language follows `docs/ui-cleanup.md`: no Cordis terms.

- **Providers:** every provider plugin grouped by kind, with a state chip (_Active_ with
  n instances, _Not set up_, _Failed_) and an **Add instance** action that opens the existing
  provider form. This is the "browser": one searchable list instead of five separate pages.
- **Features:** toggles for built-in feature plugins with dependency warnings.

Admin-only (reuse `@magpiejs/auth`). The page is a client entry of `@magpiejs/plugins`,
built with the rest of the web console.

## Phasing

1. `@magpiejs/plugins` with `list()` and the **Providers** tab, read-only plus "Add
   instance" handing off to the existing form.
2. **Features** tab with `setFeature` and the optional `magpie.needs` metadata.
3. Failed-state reporting into the health plugin.

## Testing

With `packages/testing`:

- `list()` reports each built-in provider with correct instance counts and state.
- `setFeature` disables and re-enables an entry, and refuses when a dependant is enabled.
- A provider entry that throws on load shows as _Failed_ and the others still start.

## Deferred: user installs

Not part of this work. If it is picked up later it would need its own proposal. The things
that make it a separate piece of work, so they aren't lost:

- A way to get packages onto disk, and a second discovery location (`settings` is currently
  hard-wired to the workspace `plugins/*` siblings).
- Third-party plugins would have to ship compiled JS, as built-ins export `.ts`.
- Plugin console pages are built at Magpie build time, so installed plugins couldn't add
  pages at runtime.
- Third-party code runs in-process with access to the database and API keys, so it needs a
  trust model (curated registry, integrity pinning, admin-only, no install scripts).
- ESM can't unload code, so updates and uninstalls would need a restart, and Magpie has no
  self-restart today.
- PLAN.md reserves `<config>/plugins/` for this.

## Open questions

1. Should the Providers tab replace the per-kind pages, or sit beside them as an index?
2. Which built-in features, if any, must not be toggleable (e.g. `database`, `auth`, `api`)?
   Proposal: only plugins listed as optional can be toggled.
